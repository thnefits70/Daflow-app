import { prisma } from "@/lib/prisma";
import { auth } from "@/auth";
import { notifyOwner, resolveNotifications } from "@/lib/notifications";
import { getCurrentStockByItemIds } from "@/lib/stockKardex";
import type { PendingItem } from "@/lib/pendingTasks";

// Productos privatizados en Dropi (pedido del usuario 2026-10-17; ver el
// comentario de DropiPrivatization en schema.prisma). DAFLOW hace todo el
// análisis: el asesor solo registra y, cuando DAFLOW le dice que no vende o
// venció, llama al dropshipper o desprivatiza.
// - Michelle (asesora humana): PROVEDIX e IMPORTADORA DAMIAN.
// - Yair: IMPORTADORA SHANGHAI y ROCKET.
// - Bryan (líder de Análisis de Mercado) aprueba antes de privatizar.
// - Todos (y el admin, en solo lectura) ven los KPIs.

export const PRIVATIZATION_ACCOUNTS = ["PROVEDIX", "IMPORTADORA DAMIAN", "IMPORTADORA SHANGHAI", "ROCKET"] as const;
const ACCOUNTS_BY_USERNAME: Record<string, string[]> = {
  mramirez: ["PROVEDIX", "IMPORTADORA DAMIAN"],
  yairurgilez: ["IMPORTADORA SHANGHAI", "ROCKET"],
};
// Sin ventas de ese producto con esa tienda por estos días → "llamar o desprivatizar".
export const NO_SALES_DAYS = 5;
export const PRIVATIZATIONS_URL = "/area/workspace?tab=privatizados";
const ADMIN_URL = "/admin";
const DAY = 864e5;

export const privatizationCode = (n: number) => `PV-${String(n).padStart(4, "0")}`;
const norm = (s: string) => s.trim().toLowerCase().replace(/\s+/g, " ");

export type PrivatizationRole = {
  userId: string;
  isAdmin: boolean;
  accounts: string[]; // en cuáles puede registrar
  canApprove: boolean; // Bryan
};

export async function getPrivatizationRole(): Promise<PrivatizationRole | null> {
  const session = await auth();
  if (!session) return null;
  if (session.user.role === "admin") return { userId: "admin", isAdmin: true, accounts: [], canApprove: false };
  const u = await prisma.user.findUnique({
    where: { id: session.user.id },
    select: { username: true, isActive: true, isLeader: true, leadsDept: { select: { code: true } } },
  });
  if (!u?.isActive) return null;
  const role: PrivatizationRole = {
    userId: session.user.id,
    isAdmin: false,
    accounts: ACCOUNTS_BY_USERNAME[u.username ?? ""] ?? [],
    canApprove: !!u.isLeader && u.leadsDept?.code === "MKT",
  };
  if (!role.accounts.length && !role.canApprove) return null;
  return role;
}

// ---- Producto ----------------------------------------------------------------

export async function lookupPrivatizationProduct(productId: string) {
  const id = productId.trim().toUpperCase().replace(/\s+/g, "");
  const item = await prisma.purchaseCatalogItem.findFirst({ where: { justCode: id }, select: { id: true, name: true } });
  const stock = item ? ((await getCurrentStockByItemIds([item.id])).get(item.id)?.balance ?? 0) : null;
  const active = await prisma.dropiPrivatization.findMany({
    where: { productId: id, status: { in: ["APPROVAL", "APPROVED", "ACTIVE"] } },
    select: { number: true, units: true, storeName: true, status: true },
  });
  const privatized = active.filter((a) => a.status === "ACTIVE").reduce((s, a) => s + a.units, 0);
  return {
    productId: id,
    catalogItemId: item?.id ?? null,
    name: item?.name ?? null,
    stock,
    privatizedUnits: privatized,
    publicUnits: stock == null ? null : Math.max(0, stock - privatized),
    others: active.map((a) => ({ code: privatizationCode(a.number), units: a.units, storeName: a.storeName, status: a.status })),
  };
}

// ---- Historial del dropshipper (por correo) -----------------------------------

export async function emailTrackRecord(email: string) {
  const rows = await prisma.dropiPrivatization.findMany({ where: { email: norm(email), status: "ENDED" }, select: { outcome: true } });
  const total = rows.length;
  const met = rows.filter((r) => r.outcome === "CUMPLIO").length;
  const half = rows.filter((r) => r.outcome === "A_MEDIAS").length;
  const failed = rows.filter((r) => r.outcome === "NO_CUMPLIO").length;
  return { total, met, half, failed, warn: total > 0 && met / total < 0.5 };
}

// ---- Ventas que DAFLOW mide solo ------------------------------------------------

export type PrivatizationSales = { units: number; guides: number; delivered: number; returned: number; lastDay: string | null };

// Guías de los cortes con ese producto y ese nombre de tienda (remitente de la
// etiqueta) desde que se privatizó; NICK dice si se entregaron o devolvieron.
async function salesFor(p: { productId: string; storeName: string; privatizedAt: Date; endedAt: Date | null }): Promise<PrivatizationSales> {
  const fromDay = new Date(p.privatizedAt.getTime() - 5 * 3600e3).toISOString().slice(0, 10);
  const toDay = p.endedAt ? new Date(p.endedAt.getTime() - 5 * 3600e3).toISOString().slice(0, 10) : "9999-12-31";
  const rows = await prisma.$queryRaw<{ guide: string; qty: number; day: string | null; grp: string | null }[]>`
    SELECT g."guideNumber" guide, sum(COALESCE((lp->>'qty')::int, 1))::int AS qty, g."manifestDay" AS "day", s."statusGroup" AS grp
    FROM "FulfillmentRequestGuide" g
    CROSS JOIN LATERAL jsonb_array_elements(CASE WHEN jsonb_typeof(g."labelProducts") = 'array' THEN g."labelProducts" ELSE '[]'::jsonb END) lp
    LEFT JOIN "NickGuideStatus" s ON s."guideNumber" = upper(replace(g."guideNumber", ' ', ''))
    WHERE lower(trim(g."sender")) = ${norm(p.storeName)}
      AND upper(lp->>'code') = ${p.productId}
      AND g."manifestDay" >= ${fromDay} AND g."manifestDay" <= ${toDay}
    GROUP BY g."guideNumber", g."manifestDay", s."statusGroup"`;
  return {
    units: rows.reduce((a, r) => a + r.qty, 0),
    guides: rows.length,
    delivered: rows.filter((r) => r.grp === "ENTREGADA").length,
    returned: rows.filter((r) => r.grp === "DEVOLUCION" || r.grp === "CANCELADA").length,
    lastDay: rows.map((r) => r.day).filter((d): d is string => !!d).sort().pop() ?? null,
  };
}

export type PrivatizationHealth = "CUMPLIDA" | "CUMPLIENDO" | "ATRASADA" | "SIN_VENTAS" | "VENCIDA";

// Lo que DAFLOW le dice al asesor, en simple.
function healthOf(p: { goalUnits: number; deadline: Date; privatizedAt: Date }, s: PrivatizationSales, now: Date): { health: PrivatizationHealth; message: string } {
  const left = Math.max(0, p.goalUnits - s.units);
  if (s.units >= p.goalUnits) return { health: "CUMPLIDA", message: `Cumplió la meta: vendió ${s.units} de ${p.goalUnits}.` };
  if (now > p.deadline) return { health: "VENCIDA", message: `Venció el plazo: vendió ${s.units} de ${p.goalUnits}. Desprivatizar o hablar con el dropshipper.` };
  const lastSale = s.lastDay ? new Date(`${s.lastDay}T17:00:00-05:00`) : p.privatizedAt;
  const quiet = Math.floor((now.getTime() - lastSale.getTime()) / DAY);
  if (quiet >= NO_SALES_DAYS)
    return {
      health: "SIN_VENTAS",
      message: s.units ? `No vende hace ${quiet} días (lleva ${s.units} de ${p.goalUnits}). Llamar o desprivatizar.` : `No ha vendido nada en ${quiet} días. Llamar o desprivatizar.`,
    };
  const total = Math.max(1, p.deadline.getTime() - p.privatizedAt.getTime());
  const expected = (p.goalUnits * (now.getTime() - p.privatizedAt.getTime())) / total;
  if (s.units + 0.01 < expected * 0.8) return { health: "ATRASADA", message: `Va atrasado: vendió ${s.units} de ${p.goalUnits}; a esta altura debería llevar unas ${Math.ceil(expected)}. Faltan ${left}.` };
  return { health: "CUMPLIENDO", message: `Va bien: vendió ${s.units} de ${p.goalUnits}. Faltan ${left}.` };
}

const outcomeOf = (sold: number, goal: number) => (sold >= goal ? "CUMPLIO" : sold >= goal * 0.5 ? "A_MEDIAS" : "NO_CUMPLIO");

// ---- Acciones ------------------------------------------------------------------

export type CreatePrivatizationInput = {
  account: string;
  productId: string;
  productName: string | null;
  units: number;
  email: string;
  storeName: string;
  phone: string;
  goalUnits: number;
  deadline: string; // YYYY-MM-DD
  note: string | null;
};

export async function createPrivatization(input: CreatePrivatizationInput, role: PrivatizationRole) {
  if (!role.accounts.includes(input.account)) return { ok: false as const, error: "Esa cuenta no te corresponde." };
  const product = await lookupPrivatizationProduct(input.productId);
  const name = product.name ?? input.productName?.trim();
  if (!name) return { ok: false as const, error: "Ese ID no está en el catálogo: escribe el nombre del producto." };
  if (!/^\d{4}-\d{2}-\d{2}$/.test(input.deadline)) return { ok: false as const, error: "Elige la fecha límite del acuerdo." };
  const deadline = new Date(`${input.deadline}T23:59:59-05:00`);
  if (deadline.getTime() <= Date.now()) return { ok: false as const, error: "La fecha límite tiene que ser después de hoy." };
  if (input.goalUnits < 1 || input.units < 1) return { ok: false as const, error: "La cantidad y la meta tienen que ser al menos 1." };
  if (input.goalUnits > input.units) return { ok: false as const, error: "La meta no puede ser mayor que las unidades privatizadas." };
  if (product.publicUnits != null && input.units > product.publicUnits)
    return { ok: false as const, error: `Solo hay ${product.publicUnits} unidades públicas de ese producto (stock ${product.stock}).` };
  const email = norm(input.email);
  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) return { ok: false as const, error: "Correo inválido." };
  const phone = input.phone.replace(/[^\d+]/g, "");
  if (phone.replace(/\D/g, "").length < 7) return { ok: false as const, error: "Escribe el teléfono del dropshipper." };
  const dup = await prisma.dropiPrivatization.findFirst({
    where: { productId: product.productId, email, status: { in: ["APPROVAL", "APPROVED", "ACTIVE"] } },
    select: { number: true },
  });
  if (dup) return { ok: false as const, error: `Ese producto ya está registrado para ese correo (${privatizationCode(dup.number)}).` };

  const row = await prisma.dropiPrivatization.create({
    data: {
      account: input.account,
      productId: product.productId,
      productName: name,
      catalogItemId: product.catalogItemId,
      units: input.units,
      email,
      storeName: input.storeName.trim().replace(/\s+/g, " "),
      phone,
      goalUnits: input.goalUnits,
      deadline,
      note: input.note?.trim() || null,
      createdById: role.userId,
    },
    select: { number: true },
  });
  const code = privatizationCode(row.number);
  const track = await emailTrackRecord(email);
  const trackTxt = track.total ? ` Historial: cumplió ${track.met} de ${track.total}.` : " Dropshipper nuevo.";
  await Promise.all(
    (await mktLeadIds()).map((id) => notifyOwner(id, { title: T_APPROVE, body: `${code} · ${name} · ${input.units} u. para ${input.storeName}.${trackTxt}`, url: PRIVATIZATIONS_URL }).catch(() => null)),
  );
  return { ok: true as const, code };
}

const T_APPROVE = "🔒 Privatización por aprobar";
const T_RESULT = "Privatización";

async function mktLeadIds(): Promise<string[]> {
  const rows = await prisma.user.findMany({ where: { isActive: true, isLeader: true, leadsDept: { code: "MKT" } }, select: { id: true } });
  return rows.map((r) => r.id);
}

export async function reviewPrivatization(id: string, approve: boolean, note: string | null, role: PrivatizationRole) {
  if (!role.canApprove) return { ok: false as const, error: "Solo Bryan aprueba." };
  const p = await prisma.dropiPrivatization.findUnique({ where: { id } });
  if (!p || p.status !== "APPROVAL") return { ok: false as const, error: "Ya no está por aprobar." };
  if (!approve && !note?.trim()) return { ok: false as const, error: "Escribe el motivo." };
  await prisma.dropiPrivatization.update({
    where: { id },
    data: { status: approve ? "APPROVED" : "REJECTED", reviewedById: role.userId, reviewedAt: new Date(), reviewNote: note?.trim() || null },
  });
  const code = privatizationCode(p.number);
  await Promise.all((await mktLeadIds()).map((uid) => resolveNotifications(uid, T_APPROVE, `${code} ·`).catch(() => null)));
  await notifyOwner(p.createdById, {
    title: T_RESULT,
    body: approve ? `${code} · Bryan la aprobó: privatiza ${p.units} u. de ${p.productName} a ${p.email} en Dropi y márcala aquí.` : `${code} · Bryan no la aprobó: ${note}.`,
    url: PRIVATIZATIONS_URL,
  }).catch(() => null);
  return { ok: true as const };
}

export async function markPrivatized(id: string, role: PrivatizationRole) {
  const p = await prisma.dropiPrivatization.findUnique({ where: { id } });
  if (!p || p.status !== "APPROVED" || !role.accounts.includes(p.account)) return { ok: false as const, error: "No se puede marcar." };
  await prisma.dropiPrivatization.update({ where: { id }, data: { status: "ACTIVE", privatizedAt: new Date() } });
  return { ok: true as const };
}

// Desprivatizar: el asesor lo hace directo (sin aprobación). DAFLOW guarda lo
// vendido y calcula el resultado.
export async function endPrivatization(id: string, note: string | null, role: PrivatizationRole) {
  const p = await prisma.dropiPrivatization.findUnique({ where: { id } });
  if (!p || !role.accounts.includes(p.account)) return { ok: false as const, error: "No autorizado." };
  if (p.status === "APPROVAL" || p.status === "APPROVED") {
    await prisma.dropiPrivatization.update({ where: { id }, data: { status: "CANCELLED", endedAt: new Date(), endedById: role.userId, endNote: note?.trim() || null } });
    if (p.status === "APPROVAL") await Promise.all((await mktLeadIds()).map((uid) => resolveNotifications(uid, T_APPROVE, `${privatizationCode(p.number)} ·`).catch(() => null)));
    return { ok: true as const };
  }
  if (p.status !== "ACTIVE" || !p.privatizedAt) return { ok: false as const, error: "Ya no está activa." };
  const now = new Date();
  const s = await salesFor({ productId: p.productId, storeName: p.storeName, privatizedAt: p.privatizedAt, endedAt: now });
  await prisma.dropiPrivatization.update({
    where: { id },
    data: { status: "ENDED", endedAt: now, endedById: role.userId, endNote: note?.trim() || null, soldUnits: s.units, outcome: outcomeOf(s.units, p.goalUnits) },
  });
  return { ok: true as const };
}

// ---- Lista + KPIs ----------------------------------------------------------------

export async function listPrivatizations() {
  const now = new Date();
  const rows = await prisma.dropiPrivatization.findMany({
    where: { OR: [{ status: { in: ["APPROVAL", "APPROVED", "ACTIVE"] } }, { createdAt: { gte: new Date(Date.now() - 180 * DAY) } }] },
    orderBy: { createdAt: "desc" },
    take: 500,
  });
  const ids = [...new Set(rows.flatMap((r) => [r.createdById, r.reviewedById, r.endedById]).filter((x): x is string => !!x && x !== "admin"))];
  const users = await prisma.user.findMany({ where: { id: { in: ids } }, select: { id: true, name: true } });
  const nameOf = (id: string | null) => (id === "admin" ? "Administrador" : id ? (users.find((u) => u.id === id)?.name ?? "—") : null);
  const stock = await getCurrentStockByItemIds([...new Set(rows.map((r) => r.catalogItemId).filter((x): x is string => !!x))]);
  const activeUnitsByProduct = new Map<string, number>();
  for (const r of rows) if (r.status === "ACTIVE") activeUnitsByProduct.set(r.productId, (activeUnitsByProduct.get(r.productId) ?? 0) + r.units);
  const tracks = new Map<string, Awaited<ReturnType<typeof emailTrackRecord>>>();
  for (const e of new Set(rows.map((r) => r.email))) tracks.set(e, await emailTrackRecord(e));

  const out = [];
  for (const r of rows) {
    const live = r.status === "ACTIVE" && r.privatizedAt ? await salesFor({ productId: r.productId, storeName: r.storeName, privatizedAt: r.privatizedAt, endedAt: null }) : null;
    const h = live && r.privatizedAt ? healthOf({ goalUnits: r.goalUnits, deadline: r.deadline, privatizedAt: r.privatizedAt }, live, now) : null;
    const st = r.catalogItemId ? (stock.get(r.catalogItemId)?.balance ?? null) : null;
    out.push({
      id: r.id,
      code: privatizationCode(r.number),
      account: r.account,
      productId: r.productId,
      productName: r.productName,
      units: r.units,
      stock: st,
      publicUnits: st == null ? null : Math.max(0, st - (activeUnitsByProduct.get(r.productId) ?? 0)),
      email: r.email,
      storeName: r.storeName,
      phone: r.phone,
      goalUnits: r.goalUnits,
      deadline: r.deadline.toISOString(),
      note: r.note,
      status: r.status,
      createdById: r.createdById,
      createdByName: nameOf(r.createdById),
      createdAt: r.createdAt.toISOString(),
      reviewedByName: nameOf(r.reviewedById),
      reviewNote: r.reviewNote,
      privatizedAt: r.privatizedAt?.toISOString() ?? null,
      endedAt: r.endedAt?.toISOString() ?? null,
      endedByName: nameOf(r.endedById),
      endNote: r.endNote,
      soldUnits: r.status === "ENDED" ? r.soldUnits : (live?.units ?? null),
      delivered: live?.delivered ?? null,
      returned: live?.returned ?? null,
      outcome: r.outcome,
      health: h?.health ?? null,
      message: h?.message ?? null,
      track: tracks.get(r.email)!,
    });
  }
  return out;
}

export type PrivatizationRow = Awaited<ReturnType<typeof listPrivatizations>>[number];

export function privatizationKpis(rows: PrivatizationRow[]) {
  const active = rows.filter((r) => r.status === "ACTIVE");
  const ended = rows.filter((r) => r.status === "ENDED");
  const byAdvisor = new Map<string, { name: string; active: number; ended: number; met: number; half: number; failed: number; blocked: number }>();
  for (const r of rows.filter((x) => x.status === "ACTIVE" || x.status === "ENDED")) {
    const k = r.createdById;
    const a = byAdvisor.get(k) ?? { name: r.createdByName ?? "—", active: 0, ended: 0, met: 0, half: 0, failed: 0, blocked: 0 };
    if (r.status === "ACTIVE") {
      a.active++;
      if (r.health === "SIN_VENTAS" || r.health === "VENCIDA") a.blocked++;
    } else {
      a.ended++;
      if (r.outcome === "CUMPLIO") a.met++;
      else if (r.outcome === "A_MEDIAS") a.half++;
      else a.failed++;
    }
    byAdvisor.set(k, a);
  }
  const byEmail = new Map<string, { email: string; storeName: string; total: number; met: number; failed: number; active: number }>();
  for (const r of rows.filter((x) => x.status === "ACTIVE" || x.status === "ENDED")) {
    const e = byEmail.get(r.email) ?? { email: r.email, storeName: r.storeName, total: 0, met: 0, failed: 0, active: 0 };
    if (r.status === "ACTIVE") e.active++;
    else {
      e.total++;
      if (r.outcome === "CUMPLIO") e.met++;
      if (r.outcome === "NO_CUMPLIO") e.failed++;
    }
    byEmail.set(r.email, e);
  }
  return {
    active: active.length,
    activeUnits: active.reduce((a, r) => a + r.units, 0),
    pendingApproval: rows.filter((r) => r.status === "APPROVAL").length,
    toPrivatize: rows.filter((r) => r.status === "APPROVED").length,
    blocked: active.filter((r) => r.health === "SIN_VENTAS" || r.health === "VENCIDA").length,
    blockedUnits: active.filter((r) => r.health === "SIN_VENTAS" || r.health === "VENCIDA").reduce((a, r) => a + r.units, 0),
    onTrack: active.filter((r) => r.health === "CUMPLIENDO" || r.health === "CUMPLIDA").length,
    late: active.filter((r) => r.health === "ATRASADA").length,
    endedTotal: ended.length,
    endedMet: ended.filter((r) => r.outcome === "CUMPLIO").length,
    endedHalf: ended.filter((r) => r.outcome === "A_MEDIAS").length,
    endedFailed: ended.filter((r) => r.outcome === "NO_CUMPLIO").length,
    byAdvisor: [...byAdvisor.values()],
    worstDropshippers: [...byEmail.values()].filter((e) => e.failed > 0).sort((a, b) => b.failed - a.failed).slice(0, 10),
    bestDropshippers: [...byEmail.values()].filter((e) => e.met > 0).sort((a, b) => b.met - a.met).slice(0, 10),
  };
}

// ---- Pendientes de Inicio ---------------------------------------------------------

export async function getPrivatizationPendingItems(userId: string): Promise<PendingItem[]> {
  const u = await prisma.user.findUnique({ where: { id: userId }, select: { username: true, isLeader: true, leadsDept: { select: { code: true } } } });
  if (!u) return [];
  const items: PendingItem[] = [];
  if (u.isLeader && u.leadsDept?.code === "MKT") {
    const rows = await prisma.dropiPrivatization.findMany({ where: { status: "APPROVAL" }, select: { number: true } });
    if (rows.length)
      items.push({ type: "privatizacion_aprobar", icon: "🔒", label: "Privatizaciones por aprobar", meta: rows.map((r) => privatizationCode(r.number)).join(", "), overdue: true, href: PRIVATIZATIONS_URL });
  }
  const accounts = ACCOUNTS_BY_USERNAME[u.username ?? ""];
  if (accounts) {
    const approved = await prisma.dropiPrivatization.findMany({ where: { status: "APPROVED", createdById: userId }, select: { number: true } });
    if (approved.length)
      items.push({ type: "privatizacion_hacer", icon: "🔒", label: "Privatizar en Dropi (ya aprobado)", meta: approved.map((r) => privatizationCode(r.number)).join(", "), overdue: true, href: PRIVATIZATIONS_URL });
    const now = new Date();
    const active = await prisma.dropiPrivatization.findMany({ where: { status: "ACTIVE", account: { in: accounts } } });
    const alert: string[] = [];
    for (const p of active) {
      if (!p.privatizedAt) continue;
      const h = healthOf(p as { goalUnits: number; deadline: Date; privatizedAt: Date }, await salesFor({ ...p, privatizedAt: p.privatizedAt, endedAt: null }), now);
      if (h.health === "SIN_VENTAS" || h.health === "VENCIDA") alert.push(privatizationCode(p.number));
    }
    if (alert.length)
      items.push({ type: "privatizacion_revisar", icon: "📞", label: "Privatizados sin vender o vencidos: llamar o desprivatizar", meta: alert.join(", "), overdue: true, href: PRIVATIZATIONS_URL });
  }
  return items;
}

export const PRIVATIZATION_ADMIN_URL = ADMIN_URL;
