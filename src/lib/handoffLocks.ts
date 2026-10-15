import { prisma } from "@/lib/prisma";
import { addBusinessHours, businessHoursBetween } from "@/lib/businessHours";
import { notifyOwner } from "@/lib/notifications";

// Pedido del usuario 2026-10-15 (caso Set billetera / Intercomunicador: la
// mercadería llegaba y no entraba a INVESTOCK porque el ID madre y la
// liberación al Kardex se quedaban esperando días):
// - La asesora B2B (quien tiene canPublishMarketProduct, hoy Michelle) tiene
//   6 horas laborables desde que se PAGA la compra para crear el ID madre en
//   Dropi y ponerlo en DAFLOW.
// - Bryan (líder de Análisis de Mercado) tiene 3 horas laborables desde que
//   el producto ya tiene ID Y la mercadería ya está en bodega para liberarla
//   al Kardex con un clic.
// Pasado el plazo, DAFLOW se le bloquea con una capa encima de la pantalla
// (no se pierde lo que estaba haciendo) y la única opción es resolver eso.
// Horas laborables = horario único de la empresa (businessHours.ts).
export const ID_DEADLINE_HOURS = 6;
export const RELEASE_DEADLINE_HOURS = 3;

// Decisión del usuario 2026-10-15: lo que ya estaba atrasado al subir esto
// empieza a contar desde ese momento, para que nadie quede bloqueado de golpe.
export const HANDOFF_CLOCK_START = new Date("2026-10-15T16:00:00Z");

// paused = Dropi está marcado como caído: el reloj no corre. extraHours =
// prórrogas ya dadas; canRequestExtension = la asesora B2B puede pedir una
// (la 1.ª se aplica sola, las siguientes esperan al admin: extensionPending).
export type HandoffItem = {
  proposalId: string;
  name: string;
  since: string;
  deadline: string;
  overdue: boolean;
  paused: boolean;
  units: number;
  extraHours: number;
  autoExtensionUsed: boolean;
  extensionPending: boolean;
};

// Pedido del usuario 2026-10-15: si Dropi no funciona, la asesora B2B pide
// 2 h laborables más con captura (la primera se aplica sola, una vez por
// producto; las siguientes las da el admin). Bryan o el admin pueden marcar
// "Dropi está caído": mientras tanto ningún reloj corre.
export const EXTENSION_HOURS = 2;

type Outage = { startedAt: Date; endedAt: Date | null };

async function getOutages(): Promise<Outage[]> {
  return prisma.dropiOutage.findMany({ where: { OR: [{ endedAt: null }, { endedAt: { gte: HANDOFF_CLOCK_START } }] }, select: { startedAt: true, endedAt: true }, orderBy: { startedAt: "asc" } });
}

function later(a: Date, b: Date): Date {
  return a > b ? a : b;
}

// Plazo = inicio + horas (+ prórrogas), corrido por las horas laborables que
// Dropi estuvo caído antes de que venciera. Con una caída abierta, en pausa.
function toItem(
  base: { proposalId: string; name: string; units: number },
  since: Date,
  hours: number,
  outages: Outage[],
  now: Date,
  ext: { extraHours: number; autoExtensionUsed: boolean; extensionPending: boolean } = { extraHours: 0, autoExtensionUsed: false, extensionPending: false },
): HandoffItem {
  const start = later(since, HANDOFF_CLOCK_START);
  let deadline = addBusinessHours(start, hours + ext.extraHours);
  let paused = false;
  for (const o of outages) {
    if (o.startedAt >= deadline) continue;
    if (!o.endedAt) {
      paused = true;
      continue;
    }
    deadline = addBusinessHours(deadline, businessHoursBetween(later(o.startedAt, start), o.endedAt));
  }
  return { ...base, ...ext, since: since.toISOString(), deadline: deadline.toISOString(), overdue: !paused && now >= deadline, paused };
}

// Productos nuevos aprobados, con compra ya pagada, que todavía no tienen ID madre.
export async function getIdDeadlineItems(now = new Date()): Promise<HandoffItem[]> {
  const proposals = await prisma.marketProductProposal.findMany({
    where: { status: "APPROVED", publishedAt: null, rocketOnly: false, catalogItemId: { not: null }, catalogItem: { awaitingDropiId: true } },
    select: {
      id: true,
      productName: true,
      catalogItem: {
        select: { requests: { where: { paidAt: { not: null }, status: { not: "REJECTED" } }, select: { paidAt: true, quantity: true } } },
      },
      handoffExtensions: { select: { hours: true, grantedAt: true, auto: true } },
    },
  });
  const outages = await getOutages();
  const items: HandoffItem[] = [];
  for (const p of proposals) {
    const paid = p.catalogItem?.requests ?? [];
    if (paid.length === 0) continue;
    const firstPaid = paid.reduce((m, r) => (r.paidAt! < m ? r.paidAt! : m), paid[0].paidAt!);
    const ext = {
      extraHours: p.handoffExtensions.filter((e) => e.grantedAt).reduce((s, e) => s + e.hours, 0),
      autoExtensionUsed: p.handoffExtensions.some((e) => e.auto),
      extensionPending: p.handoffExtensions.some((e) => !e.grantedAt),
    };
    items.push(toItem({ proposalId: p.id, name: p.productName, units: paid.reduce((s, r) => s + r.quantity, 0) }, firstPaid, ID_DEADLINE_HOURS, outages, now, ext));
  }
  return items.sort((a, b) => a.deadline.localeCompare(b.deadline));
}

// Con ID madre y mercadería ya aprobada en bodega, esperando que Bryan la libere.
export async function getReleaseDeadlineItems(now = new Date()): Promise<HandoffItem[]> {
  const proposals = await prisma.marketProductProposal.findMany({
    where: { publishedAt: { not: null }, dropiProductId: { not: null }, kardexReleasedAt: null, catalogItem: { awaitingDropiId: true } },
    select: {
      id: true,
      productName: true,
      publishedAt: true,
      catalogItem: {
        select: {
          requests: {
            where: { status: "RECEIVED", receipt: { approvedAt: { not: null }, stockKardexEntry: null } },
            select: { receipt: { select: { approvedAt: true, receivedQuantity: true } } },
          },
        },
      },
    },
  });
  const outages = await getOutages();
  const items: HandoffItem[] = [];
  for (const p of proposals) {
    const receipts = (p.catalogItem?.requests ?? []).map((r) => r.receipt!).filter(Boolean);
    if (receipts.length === 0) continue;
    const firstArrival = receipts.reduce((m, r) => (r.approvedAt! < m ? r.approvedAt! : m), receipts[0].approvedAt!);
    items.push(toItem({ proposalId: p.id, name: p.productName, units: receipts.reduce((s, r) => s + r.receivedQuantity, 0) }, later(firstArrival, p.publishedAt!), RELEASE_DEADLINE_HOURS, outages, now));
  }
  return items.sort((a, b) => a.deadline.localeCompare(b.deadline));
}

export type HandoffLock = { kind: "id" | "release"; items: HandoffItem[] };

// El bloqueo de esta persona (null = puede trabajar normal). El admin nunca
// se bloquea. Muestra TODOS sus pendientes (no solo los vencidos) para que
// los resuelva de una vez.
export async function getHandoffLock(userId: string): Promise<HandoffLock | null> {
  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: { isActive: true, canPublishMarketProduct: true, isLeader: true, leadsDept: { select: { code: true } } },
  });
  if (!user?.isActive) return null;
  if (user.canPublishMarketProduct) {
    const items = await getIdDeadlineItems();
    if (items.some((i) => i.overdue)) return { kind: "id", items };
  }
  if (user.isLeader && user.leadsDept?.code === "MKT") {
    const items = await getReleaseDeadlineItems();
    if (items.some((i) => i.overdue)) return { kind: "release", items };
  }
  return null;
}

// Pendiente en Inicio de la asesora B2B: el ID madre con la hora en que se bloquea.
export async function getIdDeadlinePendingItem(href: string): Promise<{ type: string; icon: string; label: string; meta: string; overdue: boolean; href: string } | null> {
  const items = await getIdDeadlineItems();
  if (items.length === 0) return null;
  const first = items[0];
  return {
    type: "analisis_mercado_id_plazo",
    icon: "⏰",
    label: "Poner el ID madre de Dropi (compra ya pagada)",
    meta: `${items.length === 1 ? first.name : `${items.length} productos`} · ${timeLeftText(first)}`,
    overdue: items.some((i) => i.overdue),
    href,
  };
}

// "se bloquea jue 15:30" / "venció" / "en pausa" — para Inicio (hora de Ecuador).
export function timeLeftText(item: { deadline: string; paused: boolean }, now = new Date()): string {
  if (item.paused) return "Dropi caído: el reloj está en pausa";
  const deadline = item.deadline;
  if (new Date(deadline) <= now) return "venció: DAFLOW queda bloqueado hasta resolverlo";
  const when = new Date(deadline).toLocaleString("es-EC", { timeZone: "America/Guayaquil", weekday: "short", hour: "2-digit", minute: "2-digit", hour12: false });
  return `se bloquea ${when}`;
}

// ---- Dropi no funciona (pedido del usuario 2026-10-15) -----------------------

type Result = { ok: true; message: string } | { ok: false; error: string };

async function marketingLeadId(): Promise<string | null> {
  const u = await prisma.user.findFirst({ where: { isLeader: true, isActive: true, leadsDept: { code: "MKT" } }, select: { id: true } });
  return u?.id ?? null;
}

// La asesora B2B pide más tiempo para el ID madre de un producto, con captura.
// La 1.ª vez se da sola (2 h laborables); después queda esperando al admin.
export async function requestIdExtension(params: { proposalId: string; userId: string; reason: string; photoUrl: string }): Promise<Result> {
  const reason = params.reason.trim();
  if (!reason) return { ok: false, error: "Escribe qué pasa con Dropi." };
  if (!params.photoUrl) return { ok: false, error: "Sube la captura del error de Dropi." };
  const item = (await getIdDeadlineItems()).find((i) => i.proposalId === params.proposalId);
  if (!item) return { ok: false, error: "Este producto ya no está esperando su ID madre." };
  if (item.extensionPending) return { ok: false, error: "Ya pediste más tiempo para este producto: espera que el admin responda." };
  const auto = !item.autoExtensionUsed;
  await prisma.handoffExtension.create({
    data: { proposalId: params.proposalId, hours: EXTENSION_HOURS, reason, photoUrl: params.photoUrl, requestedById: params.userId, auto, grantedAt: auto ? new Date() : null },
  });
  const who = (await prisma.user.findUnique({ where: { id: params.userId }, select: { name: true } }))?.name ?? "La asesora B2B";
  const body = `${who} — ${item.name}: «${reason}»`;
  if (auto) {
    const notice = { title: `⏳ Dropi no funciona: ${EXTENSION_HOURS} h más para el ID madre`, body: `${body}. Ya se le dieron ${EXTENSION_HOURS} h laborables más (la única automática).`, url: params.photoUrl };
    await notifyOwner("admin", notice).catch(() => null);
    const bryan = await marketingLeadId();
    if (bryan) await notifyOwner(bryan, notice).catch(() => null);
    return { ok: true, message: `Listo: tienes ${EXTENSION_HOURS} horas laborables más para este producto. Si Dropi sigue sin funcionar, puedes volver a pedirlo y lo decide el admin.` };
  }
  await notifyOwner("admin", { title: "⏳ Dropi sigue sin funcionar: piden más tiempo", body: `${body}. Ya usó su prórroga automática: decide en tu Inicio.`, url: "/admin" }).catch(() => null);
  return { ok: true, message: "Le llegó al admin tu pedido con la captura. Mientras responde, sigue intentando en Dropi." };
}

export type PendingExtension = { id: string; proposalId: string; name: string; reason: string; photoUrl: string | null; requestedByName: string | null; requestedAt: string };

export async function getPendingIdExtensions(): Promise<PendingExtension[]> {
  const rows = await prisma.handoffExtension.findMany({
    where: { grantedAt: null },
    orderBy: { requestedAt: "asc" },
    select: { id: true, proposalId: true, reason: true, photoUrl: true, requestedById: true, requestedAt: true, proposal: { select: { productName: true, publishedAt: true } } },
  });
  const open = rows.filter((r) => !r.proposal.publishedAt);
  const users = await prisma.user.findMany({ where: { id: { in: open.map((r) => r.requestedById).filter((x): x is string => !!x) } }, select: { id: true, name: true } });
  const name = new Map(users.map((u) => [u.id, u.name]));
  return open.map((r) => ({ id: r.id, proposalId: r.proposalId, name: r.proposal.productName, reason: r.reason, photoUrl: r.photoUrl, requestedByName: r.requestedById ? (name.get(r.requestedById) ?? null) : null, requestedAt: r.requestedAt.toISOString() }));
}

// El admin responde: da las 2 h o no (se borra el pedido).
export async function decideIdExtension(id: string, grant: boolean): Promise<Result> {
  const ext = await prisma.handoffExtension.findUnique({ where: { id }, select: { grantedAt: true, requestedById: true, proposal: { select: { productName: true } } } });
  if (!ext) return { ok: false, error: "Ese pedido ya no existe." };
  if (ext.grantedAt) return { ok: false, error: "Ese pedido ya se respondió." };
  if (grant) await prisma.handoffExtension.update({ where: { id }, data: { grantedAt: new Date(), grantedById: null } });
  else await prisma.handoffExtension.delete({ where: { id } });
  if (ext.requestedById) {
    await notifyOwner(ext.requestedById, {
      title: grant ? `⏳ Tienes ${EXTENSION_HOURS} h más para el ID madre` : "El admin no dio más tiempo para el ID madre",
      body: grant ? `${ext.proposal.productName}: el admin te dio ${EXTENSION_HOURS} horas laborables más.` : `${ext.proposal.productName}: hay que poner el ID madre ya.`,
      url: "/area/workspace?tab=analisis-mercado&ptab=publicar",
    }).catch(() => null);
  }
  return { ok: true, message: grant ? `Listo: ${EXTENSION_HOURS} horas laborables más.` : "Listo: no se dio más tiempo." };
}

export async function getActiveDropiOutage(): Promise<{ id: string; startedAt: string; startedByName: string; note: string | null } | null> {
  const o = await prisma.dropiOutage.findFirst({ where: { endedAt: null }, orderBy: { startedAt: "desc" } });
  if (!o) return null;
  const by = o.startedById ? await prisma.user.findUnique({ where: { id: o.startedById }, select: { name: true } }) : null;
  return { id: o.id, startedAt: o.startedAt.toISOString(), startedByName: by?.name ?? "el admin", note: o.note };
}

// Bryan o el admin: "Dropi está caído" / "Dropi ya volvió". userId null = admin.
export async function setDropiOutage(params: { down: boolean; userId: string | null; note?: string }): Promise<Result> {
  const active = await prisma.dropiOutage.findFirst({ where: { endedAt: null } });
  const who = params.userId ? ((await prisma.user.findUnique({ where: { id: params.userId }, select: { name: true } }))?.name ?? "Bryan") : "El admin";
  const advisors = await prisma.user.findMany({ where: { canPublishMarketProduct: true, isActive: true }, select: { id: true } });
  const bryan = await marketingLeadId();
  const tell = async (title: string, body: string) => {
    const ids = new Set([...advisors.map((a) => a.id), ...(bryan ? [bryan] : [])]);
    if (params.userId) ids.delete(params.userId);
    await Promise.all([...ids].map((id) => notifyOwner(id, { title, body, url: "/area/workspace?tab=analisis-mercado" }).catch(() => null)));
    if (params.userId) await notifyOwner("admin", { title, body, url: "/admin" }).catch(() => null);
  };
  if (params.down) {
    if (active) return { ok: false, error: "Dropi ya está marcado como caído." };
    await prisma.dropiOutage.create({ data: { startedById: params.userId, note: params.note?.trim() || null } });
    await tell("🔴 Dropi está caído", `${who} lo marcó. Los plazos del ID madre y de liberar al Kardex están en pausa hasta que vuelva.`);
    return { ok: true, message: "Marcado: los relojes están en pausa. Cuando Dropi vuelva, pulsa «Dropi ya volvió»." };
  }
  if (!active) return { ok: false, error: "Dropi no estaba marcado como caído." };
  await prisma.dropiOutage.update({ where: { id: active.id }, data: { endedAt: new Date(), endedById: params.userId } });
  await tell("🟢 Dropi ya volvió", `${who} lo marcó. Los plazos siguen corriendo desde donde quedaron.`);
  return { ok: true, message: "Listo: los relojes siguen desde donde quedaron." };
}

// Recordatorio en Inicio (Bryan y admin) mientras Dropi esté marcado como
// caído, para que no se olvide reactivarlo (rojo pasadas 2 h laborables).
export async function getDropiOutagePendingItem(href: string): Promise<{ type: string; icon: string; label: string; meta: string; overdue: boolean; href: string } | null> {
  const o = await prisma.dropiOutage.findFirst({ where: { endedAt: null }, orderBy: { startedAt: "desc" } });
  if (!o) return null;
  const hours = businessHoursBetween(o.startedAt, new Date());
  return {
    type: "dropi_caido",
    icon: "🔴",
    label: "Dropi marcado como caído — ¿ya volvió?",
    meta: `Relojes en pausa hace ${hours < 1 ? "menos de 1 h" : `${Math.floor(hours)} h`} laborables · pulsa «Dropi ya volvió» cuando funcione`,
    overdue: hours >= 2,
    href,
  };
}
