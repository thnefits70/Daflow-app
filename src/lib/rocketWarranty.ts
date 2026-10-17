import { prisma } from "@/lib/prisma";
import { auth } from "@/auth";
import { notifyOwner, resolveNotifications } from "@/lib/notifications";
import { lookupGuide } from "@/lib/localWarranty";
import { isRocketCode } from "@/lib/dropiGuidesPdf";
import { findOrderGuide } from "@/lib/nick/dropiMcp";
import { warrantyGuideAlreadyUsedError } from "@/lib/warrantyGuideUsage";
import type { PendingItem } from "@/lib/pendingTasks";

// Garantías de Rocket enviadas como orden de Dropi (pedido del usuario
// 2026-10-16, flujo aprobado por Bryan). Rocket no genera guías de garantía y
// su servicio al cliente pide gestionarlas aparte: el reemplazo sale como una
// orden normal "Sin Recaudo" en Dropi.
// - Yair (Rocket e IMPORTADORA SHANGHAI) la registra: guía de Rocket original,
//   productos, motivo y número de orden de Dropi. Máximo 10 días desde que se
//   despachó el pedido original; nunca más unidades que las de la guía.
// - Bryan la aprueba o la rechaza (si rechaza, Yair cancela la orden en Dropi).
// - NICK busca solo la guía de esa orden en Dropi — nadie la escribe. Si NICK
//   no pudo, Daniel la elige en el corte entre las guías con ese producto.
// - En el corte esa guía sale como GARANTÍA (motivo ya puesto), no como
//   pedido: no suma en Pedidos despachados y entra al KPI de Garantías.
const CREATOR_USERNAMES = new Set(["yairurgilez"]);

export const ROCKET_WARRANTY_MAX_DAYS = 10;
// Pedido del usuario 2026-10-16: Yair solo elige entre los 4 motivos normales
// (la lista del KPI también trae frases escritas a mano en cortes viejos, que
// se quedan ahí por la historia pero no se ofrecen aquí).
export const ROCKET_WARRANTY_REASONS = ["Mal funcionamiento", "Producto roto", "Pedido incompleto", "Pedido diferente"];
export const ROCKET_WARRANTIES_URL = "/area/workspace?tab=arreglos-garantia";
const ADMIN_URL = "/admin/arreglos-garantia";
// Cada cuánto NICK vuelve a preguntar a Dropi por la guía de una orden.
const NICK_RECHECK_MS = 10 * 60 * 1000;

export function rocketWarrantyCode(n: number): string {
  return `GR-${String(n).padStart(4, "0")}`;
}

export type RocketWarrantyItem = { catalogItemId: string; name: string; quantity: number };

export type RocketWarrantyRole = {
  userId: string; // "admin" para el admin
  isAdmin: boolean;
  canCreate: boolean; // Yair
  canApprove: boolean; // Bryan (líder MKT)
  canLinkGuide: boolean; // Daniel (líder INV)
};

export async function getRocketWarrantyRole(): Promise<RocketWarrantyRole | null> {
  const session = await auth();
  if (!session) return null;
  if (session.user.role === "admin") return { userId: "admin", isAdmin: true, canCreate: false, canApprove: false, canLinkGuide: false };
  const u = await prisma.user.findUnique({
    where: { id: session.user.id },
    select: { username: true, isActive: true, isLeader: true, leadsDept: { select: { code: true } } },
  });
  if (!u?.isActive) return null;
  const role: RocketWarrantyRole = {
    userId: session.user.id,
    isAdmin: false,
    canCreate: CREATOR_USERNAMES.has(u.username ?? ""),
    canApprove: !!u.isLeader && u.leadsDept?.code === "MKT",
    canLinkGuide: !!u.isLeader && u.leadsDept?.code === "INV",
  };
  if (!role.canCreate && !role.canApprove && !role.canLinkGuide) return null;
  return role;
}

export function cleanRef(s: string): string {
  return s.toUpperCase().replace(/\s+/g, "");
}

const DAY_MS = 24 * 60 * 60 * 1000;

// Unidades de cada producto ya usadas en otras garantías de Rocket de la misma guía.
async function usedUnits(originalGuide: string, exceptId?: string): Promise<Map<string, number>> {
  const rows = await prisma.rocketWarranty.findMany({
    where: { originalGuide, status: { in: ["APPROVAL", "APPROVED"] }, ...(exceptId ? { id: { not: exceptId } } : {}) },
    select: { items: true },
  });
  const used = new Map<string, number>();
  for (const r of rows) for (const it of r.items as RocketWarrantyItem[]) used.set(it.catalogItemId, (used.get(it.catalogItemId) ?? 0) + it.quantity);
  return used;
}

export type RocketGuideLookup =
  | {
      ok: true;
      guide: string;
      clientName: string | null;
      city: string | null;
      shippedAt: string;
      daysSince: number;
      lines: { catalogItemId: string; name: string; code: string | null; photo: string | null; quantity: number; left: number }[];
      warnings: string[];
    }
  | { ok: false; error: string };

// La guía de Rocket original: tiene que haber salido en uno de nuestros cortes.
export async function lookupRocketGuide(raw: string): Promise<RocketGuideLookup> {
  const guide = cleanRef(raw);
  if (guide.length < 5) return { ok: false, error: "Escribe la guía de Rocket original." };
  const row = await prisma.fulfillmentRequestGuide.findFirst({
    where: { guideNumber: { equals: guide, mode: "insensitive" } },
    select: { codes: true, batch: { select: { source: true } } },
  });
  if (row && row.batch.source !== "ROCKET" && !row.codes.some(isRocketCode)) {
    return { ok: false, error: `La guía ${guide} es de Dropi, no de Rocket. Las garantías de Dropi se piden en la sección Garantías de Dropi.` };
  }
  const r = await lookupGuide(guide);
  if (!r.ok) return r;
  const s = r.source;
  const used = await usedUnits(s.ref);
  return {
    ok: true,
    guide: s.ref,
    clientName: s.clientName,
    city: s.city,
    shippedAt: s.shippedAt,
    daysSince: s.daysSince,
    lines: s.lines.map((l) => ({ catalogItemId: l.catalogItemId, name: l.name, code: l.code, photo: l.photo, quantity: l.quantity, left: Math.max(0, l.quantity - (used.get(l.catalogItemId) ?? 0)) })),
    warnings: s.warnings,
  };
}

export type CreateRocketWarrantyInput = {
  originalGuide: string;
  items: { catalogItemId: string; quantity: number }[];
  reason: string;
  note: string | null;
  evidenceUrls: string[];
  dropiOrder: string;
};

export async function createRocketWarranty(input: CreateRocketWarrantyInput, userId: string): Promise<{ ok: true; id: string; code: string } | { ok: false; error: string }> {
  const src = await lookupRocketGuide(input.originalGuide);
  if (!src.ok) return src;
  if (src.daysSince > ROCKET_WARRANTY_MAX_DAYS) {
    return { ok: false, error: `Ya pasaron ${src.daysSince} días desde que se despachó el pedido: el plazo máximo es de ${ROCKET_WARRANTY_MAX_DAYS} días.` };
  }
  const wanted = ROCKET_WARRANTY_REASONS.find((r) => r.toLowerCase() === input.reason.trim().toLowerCase());
  const reason = wanted ? await prisma.warrantyCategory.findFirst({ where: { name: { equals: wanted, mode: "insensitive" } }, select: { name: true } }) : null;
  if (!reason) return { ok: false, error: "Elige el motivo de la lista." };
  const order = input.dropiOrder.replace(/\D/g, "");
  if (order.length < 5) return { ok: false, error: "Escribe el número de orden de Dropi (solo números)." };
  const dup = await prisma.rocketWarranty.findFirst({ where: { dropiOrder: order, status: { in: ["APPROVAL", "APPROVED"] } }, select: { number: true } });
  if (dup) return { ok: false, error: `Esa orden de Dropi ya está registrada (${rocketWarrantyCode(dup.number)}).` };

  const byId = new Map(src.lines.map((l) => [l.catalogItemId, l]));
  const qty = new Map<string, number>();
  for (const it of input.items) {
    if (!byId.has(it.catalogItemId)) return { ok: false, error: "Uno de los productos no estaba en la guía de Rocket." };
    if (!Number.isInteger(it.quantity) || it.quantity < 1) return { ok: false, error: "Cantidad inválida." };
    qty.set(it.catalogItemId, (qty.get(it.catalogItemId) ?? 0) + it.quantity);
  }
  if (qty.size === 0) return { ok: false, error: "Elige al menos un producto." };
  for (const [id, q] of qty) {
    const l = byId.get(id)!;
    if (q > l.left) return { ok: false, error: `${l.name}: la guía llevaba ${l.quantity}${l.left < l.quantity ? ` y ya se usaron ${l.quantity - l.left} en otra garantía` : ""} — máximo ${l.left}.` };
  }

  const row = await prisma.rocketWarranty.create({
    data: {
      status: "APPROVAL",
      originalGuide: src.guide,
      originalShippedAt: new Date(src.shippedAt),
      clientName: src.clientName,
      city: src.city,
      items: [...qty].map(([catalogItemId, quantity]) => ({ catalogItemId, name: byId.get(catalogItemId)!.name, quantity })),
      reason: reason.name,
      note: input.note?.trim() || null,
      evidenceUrls: input.evidenceUrls,
      dropiOrder: order,
      createdById: userId,
    },
    select: { id: true, number: true },
  });
  const code = rocketWarrantyCode(row.number);
  await send(await leadIds("MKT"), T_APPROVE, `${code} · guía Rocket ${src.guide} · orden Dropi ${order} · ${reason.name}.`);
  return { ok: true, id: row.id, code };
}

// ---- Avisos ------------------------------------------------------------------

const T_APPROVE = "🛡️ Garantía de Rocket por aprobar";
const T_RESULT = "Garantía de Rocket";

async function leadIds(dept: "MKT" | "INV"): Promise<string[]> {
  const rows = await prisma.user.findMany({ where: { isActive: true, isLeader: true, leadsDept: { code: dept } }, select: { id: true } });
  return rows.map((r) => r.id);
}

async function send(ids: string[], title: string, body: string) {
  await Promise.all(ids.map((id) => notifyOwner(id, { title, body, url: id === "admin" ? ADMIN_URL : ROCKET_WARRANTIES_URL }).catch(() => null)));
}

export const rocketWarrantyNotices = {
  reviewed: async (code: string, order: string, ok: boolean, creatorId: string, note: string | null) => {
    await Promise.all((await leadIds("MKT")).map((id) => resolveNotifications(id, T_APPROVE, `${code} ·`).catch(() => null)));
    await send(
      [creatorId],
      T_RESULT,
      ok ? `${code} · Bryan la aprobó. La guía de la orden ${order} se une sola.` : `${code} · Bryan no la aprobó: ${note ?? ""}. Cancela la orden ${order} en Dropi.`
    );
  },
  cancelled: async (code: string) => {
    await Promise.all((await leadIds("MKT")).map((id) => resolveNotifications(id, T_APPROVE, `${code} ·`).catch(() => null)));
  },
};

// ---- NICK: la guía de cada orden ------------------------------------------

// Busca en Dropi (con NICK, solo lectura) la guía de las órdenes que todavía
// no la tienen. Prueba las cuentas conectadas; recuerda en cuál estaba la
// orden. Nunca frena nada si Dropi no responde.
export async function linkRocketWarrantyGuides(opts: { budgetMs?: number; force?: boolean } = {}): Promise<number> {
  const start = Date.now();
  const budget = opts.budgetMs ?? 15_000;
  const pending = await prisma.rocketWarranty.findMany({
    where: {
      status: { in: ["APPROVAL", "APPROVED"] },
      guideNumber: null,
      ...(opts.force ? {} : { OR: [{ nickCheckedAt: null }, { nickCheckedAt: { lt: new Date(Date.now() - NICK_RECHECK_MS) } }] }),
    },
    orderBy: { createdAt: "asc" },
    take: 20,
  });
  if (!pending.length) return 0;
  const accounts = await prisma.nickDropiAccount.findMany({
    where: { accessTokenEnc: { not: null }, needsReconnect: false },
    orderBy: { sortOrder: "asc" },
    select: { id: true, name: true },
  });
  if (!accounts.length) return 0;
  let linked = 0;
  for (const w of pending) {
    if (Date.now() - start > budget) break;
    // Primero la cuenta donde ya se encontró antes esta orden.
    const ordered = w.dropiAccount ? [...accounts].sort((a, b) => (a.name === w.dropiAccount ? -1 : b.name === w.dropiAccount ? 1 : 0)) : accounts;
    let hit: { account: string; guide: string | null } | null = null;
    for (const acc of ordered) {
      if (Date.now() - start > budget) break;
      const r = await findOrderGuide(acc.id, w.dropiOrder).catch(() => null);
      if (r?.found) {
        hit = { account: acc.name, guide: r.guide };
        break;
      }
    }
    const now = new Date();
    if (hit?.guide) {
      // Una guía no puede ser de dos garantías.
      const taken = await warrantyGuideAlreadyUsedError(hit.guide, { rocketWarrantyId: w.id });
      if (!taken) {
        await prisma.rocketWarranty.update({ where: { id: w.id }, data: { guideNumber: hit.guide, guideLinkedAt: now, guideLinkedBy: "NICK", dropiAccount: hit.account, nickCheckedAt: now } });
        linked++;
        continue;
      }
    }
    await prisma.rocketWarranty.update({ where: { id: w.id }, data: { nickCheckedAt: now, ...(hit ? { dropiAccount: hit.account } : {}) } });
  }
  return linked;
}

// ---- Corte --------------------------------------------------------------------

export type CorteRocketWarranty = {
  id: string;
  code: string;
  status: string;
  originalGuide: string;
  dropiOrder: string;
  reason: string;
  guideNumber: string | null;
  items: RocketWarrantyItem[];
};

// Garantías abiertas que todavía no salieron: las que ya tienen guía se
// marcan como garantía al leer el PDF; las que no, se le muestran a Daniel.
export async function openRocketWarrantiesForCorte(): Promise<CorteRocketWarranty[]> {
  const rows = await prisma.rocketWarranty.findMany({
    where: { status: { in: ["APPROVAL", "APPROVED"] }, shippedAt: null },
    orderBy: { createdAt: "asc" },
  });
  return rows.map((r) => ({
    id: r.id,
    code: rocketWarrantyCode(r.number),
    status: r.status,
    originalGuide: r.originalGuide,
    dropiOrder: r.dropiOrder,
    reason: r.reason,
    guideNumber: r.guideNumber,
    items: r.items as RocketWarrantyItem[],
  }));
}

// Al guardar el corte: las garantías cuya guía salió quedan como despachadas.
export async function markRocketWarrantiesShipped(guides: string[], batchId: string): Promise<void> {
  const set = [...new Set(guides.map(cleanRef))];
  if (!set.length) return;
  const rows = await prisma.rocketWarranty.findMany({ where: { guideNumber: { in: set }, shippedAt: null, status: { in: ["APPROVAL", "APPROVED"] } }, select: { id: true, number: true, createdById: true, guideNumber: true } });
  const now = new Date();
  for (const r of rows) {
    await prisma.rocketWarranty.update({ where: { id: r.id }, data: { shippedAt: now, shippedBatchId: batchId } });
    await send([r.createdById], T_RESULT, `${rocketWarrantyCode(r.number)} · salió en el corte de hoy con la guía ${r.guideNumber}.`);
  }
}

// ---- Lista ----------------------------------------------------------------------

export async function listRocketWarranties() {
  const since = new Date(Date.now() - 60 * DAY_MS);
  const rows = await prisma.rocketWarranty.findMany({
    where: { OR: [{ status: { in: ["APPROVAL", "APPROVED"] }, shippedAt: null }, { createdAt: { gte: since } }] },
    orderBy: { createdAt: "desc" },
    take: 300,
  });
  const ids = [...new Set(rows.flatMap((r) => [r.createdById, r.reviewedById, r.guideLinkedBy]).filter((x): x is string => !!x && x !== "admin" && x !== "NICK"))];
  const users = await prisma.user.findMany({ where: { id: { in: ids } }, select: { id: true, name: true } });
  const nameOf = (id: string | null) => (id === "admin" ? "Administrador" : id === "NICK" ? "NICK (automático)" : id ? users.find((u) => u.id === id)?.name ?? "—" : null);
  return rows.map((r) => ({
    id: r.id,
    code: rocketWarrantyCode(r.number),
    status: r.status,
    originalGuide: r.originalGuide,
    originalShippedAt: r.originalShippedAt.toISOString(),
    clientName: r.clientName,
    city: r.city,
    items: r.items as RocketWarrantyItem[],
    reason: r.reason,
    note: r.note,
    evidenceUrls: r.evidenceUrls,
    dropiOrder: r.dropiOrder,
    dropiAccount: r.dropiAccount,
    guideNumber: r.guideNumber,
    guideLinkedAt: r.guideLinkedAt?.toISOString() ?? null,
    guideLinkedByName: nameOf(r.guideLinkedBy),
    shippedAt: r.shippedAt?.toISOString() ?? null,
    createdById: r.createdById,
    createdByName: nameOf(r.createdById),
    createdAt: r.createdAt.toISOString(),
    reviewedByName: nameOf(r.reviewedById),
    reviewedAt: r.reviewedAt?.toISOString() ?? null,
    reviewNote: r.reviewNote,
    cancelledAt: r.cancelledAt?.toISOString() ?? null,
  }));
}

// ---- Pendientes de Inicio ---------------------------------------------------

export async function getRocketWarrantyPendingItems(userId: string): Promise<PendingItem[]> {
  const u = await prisma.user.findUnique({ where: { id: userId }, select: { isLeader: true, leadsDept: { select: { code: true } } } });
  if (!u?.isLeader || u.leadsDept?.code !== "MKT") return [];
  const rows = await prisma.rocketWarranty.findMany({ where: { status: "APPROVAL" }, select: { number: true } });
  if (!rows.length) return [];
  return [
    {
      type: "garantia_rocket_aprobar",
      icon: "🛡️",
      label: "Garantías de Rocket por aprobar",
      meta: rows.map((r) => rocketWarrantyCode(r.number)).join(", "),
      overdue: true,
      href: ROCKET_WARRANTIES_URL,
    },
  ];
}
