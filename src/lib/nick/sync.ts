import { prisma } from "@/lib/prisma";
import { ecuadorDay } from "@/lib/fulfillmentGuides";
import { isWithinBusinessHours } from "@/lib/businessHours";
import { NickReconnectError, getValidAccessToken } from "@/lib/nick/dropiOAuth";
import { McpSession, parseDropiTable, toolText } from "@/lib/nick/dropiMcp";

// NICK Etapa 1 (aprobada 2026-10-16): estado en Dropi de cada guía.
// - Se leen las órdenes de cada cuenta por día de CREACIÓN (list_orders,
//   100 por página); las que ya tienen guía traen tracking_code y con eso se
//   unen a las guías de los cortes (99% de coincidencia en la prueba).
// - Vuelta cada 2 horas en horario de trabajo. La primera vez se leen 45
//   días; después la primera vuelta del día mira 30 y las demás 12 (lo más
//   viejo casi nunca cambia, y así se le pide poco a Dropi).
// - Si Dropi falla (ej. 504 "timed out", visto 2026-10-16) esa cuenta espera
//   10 minutos antes de reintentar, para no insistirle.
// - Va por partes: cada llamada trabaja ~40 s y guarda por dónde va
//   (NickDropiAccount.syncDay/syncStart). El plan de Vercel solo permite
//   tareas diarias, así que la dispara la campanita de quien tenga DAFLOW
//   abierto (como los avisos de Publicar en Dropi) y el botón "Actualizar ahora".
// Solo lectura: nunca cambia nada en Dropi. Sin montos ni datos del cliente.

export const NICK_SYNC_EVERY_MS = 2 * 60 * 60 * 1000;
const BACKFILL_DAYS = 45;
const DAILY_DAYS = 30;
const SHORT_DAYS = 12;
const ERROR_WAIT_MS = 10 * 60 * 1000;
const PAGE = 100;
const LOCK_MS = 90 * 1000;

export type NickGroup = "PREPARANDO" | "EN_CAMINO" | "NOVEDAD" | "ENTREGADA" | "DEVOLUCION" | "CANCELADA";

export const NICK_GROUP_LABEL: Record<NickGroup, string> = {
  PREPARANDO: "Preparando",
  EN_CAMINO: "En camino",
  NOVEDAD: "Con novedad",
  ENTREGADA: "Entregada",
  DEVOLUCION: "En devolución",
  CANCELADA: "Cancelada / anulada",
};

// Los 105 estados de Dropi (más los propios de cada transportadora) en 6
// grupos. Siempre se guarda y se muestra también el estado original.
export function statusGroup(raw: string): NickGroup {
  const s = raw.toUpperCase().replace(/_/g, " ").trim();
  if (/CANCELAD|RECHAZAD|ANULAD|INDEMNIZAD/.test(s)) return "CANCELADA";
  if (/DEVOLU|RETENCION|RECIBIDO POR DROPI|RECIBIDO PAU|EN BODEGA DROPI|RECOGIDO POR DROPI/.test(s)) return "DEVOLUCION";
  if (/NOVEDAD/.test(s) && !/SOLUCIONAD/.test(s)) return "NOVEDAD";
  if (/^ENTREGADO$|ENTREGADO AL CLIENTE|ENTREGA EXITOSA|^ENTREGADA$/.test(s)) return "ENTREGADA";
  if (/^PENDIENTE|GENERANDO GUIA|ERROR GENERANDO|GUIA GENERADA|PREPARADO PARA TRANSPORTADORA|POR RECOLECTAR/.test(s)) return "PREPARANDO";
  return "EN_CAMINO";
}

const dayStr = (d: Date) => ecuadorDay(d);
const addDays = (day: string, n: number) => {
  const d = new Date(`${day}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
};

const cleanGuide = (g: unknown) => String(g ?? "").toUpperCase().replace(/\s+/g, "").trim();

// Guarda una página de órdenes: crea las guías nuevas y anota los cambios.
async function saveRows(accountId: string, rows: Record<string, unknown>[]) {
  const withGuide = rows
    .map((o) => ({
      guideNumber: cleanGuide(o.tracking_code),
      dropiOrderId: String(o.order_id ?? "").trim(),
      status: String(o.status ?? "").trim(),
      carrier: o.shipping_company ? String(o.shipping_company).trim() : null,
      city: o.city ? String(o.city).trim() : null,
      rateType: o.rate_type ? String(o.rate_type).trim() : null,
      orderCreatedAt: o.created_at ? new Date(`${String(o.created_at).replace(" ", "T")}${/Z|[+-]\d\d:?\d\d$/.test(String(o.created_at)) ? "" : "-05:00"}`) : null,
    }))
    .filter((r) => r.guideNumber.length >= 5 && r.status && r.dropiOrderId);
  if (!withGuide.length) return { created: 0, changed: 0 };
  const existing = await prisma.nickGuideStatus.findMany({
    where: { guideNumber: { in: withGuide.map((r) => r.guideNumber) } },
    select: { guideNumber: true, status: true },
  });
  const known = new Map(existing.map((e) => [e.guideNumber, e.status]));
  const now = new Date();
  const fresh = withGuide.filter((r) => !known.has(r.guideNumber));
  const changed = withGuide.filter((r) => known.has(r.guideNumber) && known.get(r.guideNumber) !== r.status);
  const same = withGuide.filter((r) => known.get(r.guideNumber) === r.status);
  if (fresh.length) {
    await prisma.nickGuideStatus.createMany({
      data: fresh.map((r) => ({ ...r, accountId, statusGroup: statusGroup(r.status), statusSince: now, firstSeenAt: now, lastSeenAt: now })),
      skipDuplicates: true,
    });
    await prisma.nickGuideStatusChange.createMany({ data: fresh.map((r) => ({ guideNumber: r.guideNumber, fromStatus: null, toStatus: r.status, at: now })) });
  }
  for (const r of changed) {
    await prisma.nickGuideStatus.update({
      where: { guideNumber: r.guideNumber },
      data: { ...r, accountId, statusGroup: statusGroup(r.status), statusSince: now, lastSeenAt: now },
    });
  }
  if (changed.length) {
    await prisma.nickGuideStatusChange.createMany({
      data: changed.map((r) => ({ guideNumber: r.guideNumber, fromStatus: known.get(r.guideNumber) ?? null, toStatus: r.status, at: now })),
    });
  }
  if (same.length) await prisma.nickGuideStatus.updateMany({ where: { guideNumber: { in: same.map((r) => r.guideNumber) } }, data: { lastSeenAt: now } });
  return { created: fresh.length, changed: changed.length };
}

export type NickSyncProgress = {
  account: string;
  state: "listo" | "en_curso" | "esperando" | "desconectada" | "error" | "pausada";
  day: string | null;
  message: string | null;
};

// Una parte de la vuelta para UNA cuenta. force = "Actualizar ahora".
async function tickAccount(accountId: string, force: boolean, deadline: number): Promise<NickSyncProgress> {
  const acc = await prisma.nickDropiAccount.findUnique({ where: { id: accountId } });
  if (!acc) return { account: accountId, state: "error", day: null, message: "Cuenta no encontrada" };
  const base = { account: acc.name, day: acc.syncDay };
  if (!acc.accessTokenEnc || acc.needsReconnect) return { ...base, state: "desconectada", message: "Sin conectar" };

  const today = dayStr(new Date());
  const due = !acc.lastSyncAt || Date.now() - acc.lastSyncAt.getTime() >= NICK_SYNC_EVERY_MS;
  if (!acc.syncDay && !force && !due) return { ...base, state: "listo", message: null };

  const spanFor = () => (!acc.lastSyncAt ? BACKFILL_DAYS : dayStr(acc.lastSyncAt) !== today ? DAILY_DAYS : SHORT_DAYS);
  // Cuentas que no les toca leer en esta parte: solo se informa cómo van
  // (con "Actualizar ahora" se deja empezada la vuelta para su turno).
  if (deadline <= Date.now()) {
    const waitingError = !!acc.lastError && !!acc.syncLockUntil && acc.syncLockUntil.getTime() > Date.now();
    if (waitingError) return { ...base, state: "error", message: "Dropi no respondió; NICK reintenta solo en unos minutos." };
    if (acc.syncDay) return { ...base, state: "en_curso", message: null };
    if (force) {
      const day = addDays(today, -(spanFor() - 1));
      await prisma.nickDropiAccount.updateMany({ where: { id: accountId, syncDay: null }, data: { syncDay: day, syncStart: 0 } });
      return { ...base, day, state: "en_curso", message: null };
    }
    return { ...base, state: "esperando", message: null };
  }

  // Candado: si otra persona ya está corriendo esta cuenta, no se duplica.
  const now = new Date();
  const lock = await prisma.nickDropiAccount.updateMany({
    where: { id: accountId, OR: [{ syncLockUntil: null }, { syncLockUntil: { lt: now } }] },
    data: { syncLockUntil: new Date(now.getTime() + LOCK_MS) },
  });
  if (lock.count === 0) {
    return acc.lastError
      ? { ...base, state: "error", message: "Dropi no respondió; NICK reintenta solo en unos minutos." }
      : { ...base, state: "en_curso", message: "Actualizando…" };
  }

  let day = acc.syncDay;
  let start = acc.syncStart;
  if (!day) {
    // Vuelta nueva: la primera vez 45 días; la primera del día (hora Ecuador) 30; las demás 12.
    day = addDays(today, -(spanFor() - 1));
    start = 0;
  }
  try {
    const mcp = new McpSession(accountId, await getValidAccessToken(accountId));
    await mcp.init();
    while (Date.now() < deadline) {
      const r = await mcp.callTool("list_orders", { from: day, until: day, result_number: PAGE, start });
      if (r.isError) throw new Error(`Dropi: ${toolText(r).slice(0, 160)}`);
      const rows = parseDropiTable(toolText(r)) ?? [];
      await saveRows(accountId, rows);
      if (rows.length >= PAGE) {
        start += PAGE;
      } else if (day < today) {
        day = addDays(day, 1);
        start = 0;
      } else {
        day = null;
        break;
      }
      await prisma.nickDropiAccount.update({ where: { id: accountId }, data: { syncDay: day, syncStart: start, syncLockUntil: new Date(Date.now() + LOCK_MS) } });
    }
    await prisma.nickDropiAccount.update({
      where: { id: accountId },
      data: {
        syncDay: day,
        syncStart: day ? start : 0,
        syncLockUntil: null,
        lastReadAt: new Date(),
        lastError: null,
        ...(day ? {} : { lastSyncAt: new Date() }),
      },
    });
    return { account: acc.name, day, state: day ? "en_curso" : "listo", message: null };
  } catch (e) {
    await prisma.nickDropiAccount
      // Queda bloqueada 10 min: así nadie (ni la campanita ni el botón) le insiste a Dropi.
      .update({ where: { id: accountId }, data: { syncLockUntil: new Date(Date.now() + ERROR_WAIT_MS), syncDay: day, syncStart: start, lastError: e instanceof Error ? e.message.slice(0, 300) : "Error" } })
      .catch(() => null);
    if (e instanceof NickReconnectError) return { account: acc.name, day, state: "desconectada", message: e.message };
    return { account: acc.name, day, state: "error", message: e instanceof Error ? e.message : "Error leyendo Dropi" };
  }
}

// Corre una parte (~budgetMs) de UNA cuenta por vez, la que lleva más tiempo
// sin leerse, para que ninguna acapare el tiempo; las demás solo informan
// cómo van. force = "Actualizar ahora" (empieza vuelta aunque no toque).
export async function runNickSyncTick({ force = false, budgetMs = 40_000 } = {}): Promise<NickSyncProgress[]> {
  // Pedido del usuario 2026-10-16: mientras Bryan (o el admin) tenga marcado
  // "Dropi está caído", NICK no le consulta nada a Dropi.
  if (await isDropiMarkedDown()) {
    const accs = await prisma.nickDropiAccount.findMany({ orderBy: { sortOrder: "asc" }, select: { name: true, syncDay: true } });
    return accs.map((a) => ({ account: a.name, day: a.syncDay, state: "pausada" as const, message: "Dropi está marcado como caído" }));
  }
  const accounts = await prisma.nickDropiAccount.findMany({
    orderBy: [{ lastReadAt: { sort: "asc", nulls: "first" } }, { sortOrder: "asc" }],
    select: { id: true, name: true, sortOrder: true, accessTokenEnc: true, needsReconnect: true, syncDay: true, lastSyncAt: true, syncLockUntil: true },
  });
  const now = Date.now();
  const wants = (a: (typeof accounts)[number]) =>
    !!a.accessTokenEnc &&
    !a.needsReconnect &&
    (!a.syncLockUntil || a.syncLockUntil.getTime() < now) &&
    (!!a.syncDay || force || !a.lastSyncAt || now - a.lastSyncAt.getTime() >= NICK_SYNC_EVERY_MS);
  const pick = accounts.find(wants);
  const out: NickSyncProgress[] = [];
  for (const a of [...accounts].sort((x, y) => x.sortOrder - y.sortOrder)) {
    out.push(await tickAccount(a.id, force, a.id === pick?.id ? Date.now() + budgetMs : 0));
  }
  return out;
}

// Lo que llama la campanita: solo en horario de trabajo y como mucho una vez
// por minuto en todo DAFLOW (un aviso por instancia del servidor).
let lastBellTick = 0;
export async function runNickSyncFromBell() {
  if (!isWithinBusinessHours()) return;
  if (Date.now() - lastBellTick < 60_000) return;
  lastBellTick = Date.now();
  if (await isDropiMarkedDown()) return;
  const pending = await prisma.nickDropiAccount.count({
    where: {
      accessTokenEnc: { not: null },
      needsReconnect: false,
      OR: [{ syncDay: { not: null } }, { lastSyncAt: null }, { lastSyncAt: { lt: new Date(Date.now() - NICK_SYNC_EVERY_MS) } }],
    },
  });
  if (pending) await runNickSyncTick({ budgetMs: 40_000 });
  // Etapa 3: marcador del día para la tendencia (como mucho cada 3 horas).
  const { saveNickScoreDay } = await import("@/lib/nick/score");
  await saveNickScoreDay().catch(() => null);
}

async function isDropiMarkedDown() {
  return !!(await prisma.dropiOutage.findFirst({ where: { endedAt: null }, select: { id: true } }));
}

// Al pulsar "Dropi ya volvió": se quita la espera de 10 min por error para que
// NICK retome en la siguiente revisión de la campanita (menos de 1 minuto) o
// con "Actualizar ahora", desde donde quedó cada cuenta.
export async function resumeNickAfterDropiBack() {
  await prisma.nickDropiAccount.updateMany({ where: { lastError: { not: null } }, data: { syncLockUntil: null, lastError: null } });
}
