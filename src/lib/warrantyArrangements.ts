import { prisma } from "@/lib/prisma";
import { auth } from "@/auth";
import { notifyOwner, resolveNotifications } from "@/lib/notifications";
import { resolveCostBasisForCatalogItems } from "@/lib/marketProduct";
import { bodegaUnitCost } from "@/lib/dropiPricing";
import { WARRANTY_PICKUP_FREIGHT_AVG } from "@/lib/localWarrantyConstants";
import type { PendingItem } from "@/lib/pendingTasks";

// Arreglos de garantía (pedido de Bryan 2026-10-15, reglas del usuario):
// - RESHIP: reenvío por mala gestión del dropshipper. Él paga el flete exacto
//   POR ADELANTADO (wallet de Dropi o transferencia); Michelle o Yair suben el
//   comprobante con el número de pedido. El admin verifica el pago y recién
//   ahí Allan o Daniel generan la guía y la anotan (2026-10-17: Daniel es
//   líder, no el único que opera). Ese flete no es pérdida nuestra.
// - CASH: arreglo en dinero con el DROPSHIPPER en vez de garantía (él es
//   nuestro cliente; con el cliente final no hacemos nada — usuario 2026-10-17).
//   Bryan aprueba; el admin paga desde la cuenta principal (nunca
//   Caja Chica) y sube el comprobante. Nunca más que 2 fletes + producto.
const CREATOR_USERNAMES = new Set(["mramirez", "yairurgilez"]);
// Generan y anotan la guía del reenvío, además del líder de Inventario.
const GUIDE_USERNAMES = new Set(["allan2026"]);

// Desde 2026-10-17 es una pestaña de "Mi área de trabajo".
export const ARRANGEMENTS_AREA_URL = "/area/workspace?tab=arreglos-garantia";
export const ARRANGEMENTS_ADMIN_URL = "/admin/arreglos-garantia";

export function arrangementCode(n: number): string {
  return `AR-${String(n).padStart(4, "0")}`;
}

export type ArrangementRole = {
  userId: string; // "admin" para el admin
  isAdmin: boolean;
  canCreate: boolean;
  canApprove: boolean; // Bryan (líder MKT)
  canAttachGuide: boolean; // Allan o Daniel (líder INV)
};

export async function getArrangementRole(): Promise<ArrangementRole | null> {
  const session = await auth();
  if (!session) return null;
  if (session.user.role === "admin") return { userId: "admin", isAdmin: true, canCreate: false, canApprove: false, canAttachGuide: false };
  const u = await prisma.user.findUnique({
    where: { id: session.user.id },
    select: { username: true, isActive: true, isLeader: true, leadsDept: { select: { code: true } } },
  });
  if (!u?.isActive) return null;
  const role: ArrangementRole = {
    userId: session.user.id,
    isAdmin: false,
    canCreate: CREATOR_USERNAMES.has(u.username ?? ""),
    canApprove: !!u.isLeader && u.leadsDept?.code === "MKT",
    canAttachGuide: GUIDE_USERNAMES.has(u.username ?? "") || (!!u.isLeader && u.leadsDept?.code === "INV"),
  };
  if (!role.canCreate && !role.canApprove && !role.canAttachGuide) return null;
  return role;
}

// Lo máximo que puede costar un arreglo en dinero: 2 fletes + el producto al
// costo puesto en bodega (Bryan, 2026-10-15). Si no se conoce el costo, solo
// los 2 fletes.
export async function maxCashSettlement(catalogItemId: string | null): Promise<number> {
  let product = 0;
  if (catalogItemId) {
    const b = (await resolveCostBasisForCatalogItems([catalogItemId])).get(catalogItemId);
    if (b) product = bodegaUnitCost(b.batchCost, b.freightCost, b.batchUnits);
  }
  return Math.round((2 * WARRANTY_PICKUP_FREIGHT_AVG + product) * 100) / 100;
}

async function bryanIds(): Promise<string[]> {
  const rows = await prisma.user.findMany({ where: { isActive: true, isLeader: true, leadsDept: { code: "MKT" } }, select: { id: true } });
  return rows.map((r) => r.id);
}

async function guideIds(): Promise<string[]> {
  const rows = await prisma.user.findMany({ where: { isActive: true, OR: [{ username: { in: [...GUIDE_USERNAMES] } }, { isLeader: true, leadsDept: { code: "INV" } }] }, select: { id: true } });
  return rows.map((r) => r.id);
}

const T_VERIFY = "💵 Verificar pago de flete (dropshipper)";
const T_GUIDE = "📦 Reenvío pagado: generar guía";
const T_APPROVE = "🤝 Arreglo en dinero por aprobar";
const T_PAY = "💸 Arreglo en dinero por pagar";
const T_RESULT = "Arreglo de garantía";

async function send(ids: string[], title: string, body: string, url = ARRANGEMENTS_AREA_URL) {
  await Promise.all(ids.map((id) => notifyOwner(id, { title, body, url: id === "admin" ? ARRANGEMENTS_ADMIN_URL : url }).catch(() => null)));
}
async function resolve(ids: string[], title: string, code: string) {
  await Promise.all(ids.map((id) => resolveNotifications(id, title, `${code} ·`).catch(() => null)));
}

export const arrangementNotices = {
  paymentSubmitted: (code: string, order: string) => send(["admin"], T_VERIFY, `${code} · pedido ${order}. Revisa que el pago llegó antes de despachar.`),
  paymentReviewed: async (code: string, order: string, ok: boolean, creatorId: string, note: string | null) => {
    await resolve(["admin"], T_VERIFY, code);
    if (ok) await send(await guideIds(), T_GUIDE, `${code} · pedido ${order}. Genera la guía y anótala.`);
    await send([creatorId], T_RESULT, `${code} · ${ok ? "el admin verificó el pago del flete; Allan o Daniel generan la guía." : `el pago no se verificó: ${note ?? ""}. Sube el comprobante correcto.`}`);
  },
  guideAttached: async (code: string, guide: string, creatorId: string, who: string) => {
    await resolve(await guideIds(), T_GUIDE, code);
    await send([creatorId], T_RESULT, `${code} · ${who} anotó la guía ${guide}.`);
  },
  cashCreated: async (code: string, amount: number) => send(await bryanIds(), T_APPROVE, `${code} · $${amount.toFixed(2)} al dropshipper en vez de garantía.`),
  cashReviewed: async (code: string, ok: boolean, creatorId: string, note: string | null) => {
    await resolve(await bryanIds(), T_APPROVE, code);
    if (ok) await send(["admin"], T_PAY, `${code} · Bryan lo aprobó. Paga desde la cuenta principal y sube el comprobante.`);
    await send([creatorId], T_RESULT, `${code} · ${ok ? "Bryan aprobó el arreglo; falta que el admin pague." : `Bryan no lo aprobó: ${note ?? ""}`}`);
  },
  cashPaid: async (code: string, creatorId: string) => {
    await resolve(["admin"], T_PAY, code);
    await send([creatorId], T_RESULT, `${code} · el admin ya pagó al dropshipper. Avísale.`);
  },
  cancelled: async (code: string) => {
    await resolve(["admin"], T_VERIFY, code);
    await resolve(["admin"], T_PAY, code);
    await resolve(await bryanIds(), T_APPROVE, code);
    await resolve(await guideIds(), T_GUIDE, code);
  },
};

export async function listArrangements(role: ArrangementRole) {
  const since = new Date(Date.now() - 60 * 24 * 60 * 60 * 1000);
  const rows = await prisma.warrantyArrangement.findMany({
    where: {
      OR: [{ status: { in: ["PAYMENT_REVIEW", "PAYMENT_REJECTED", "PAYMENT_OK", "APPROVAL", "TO_PAY"] } }, { createdAt: { gte: since } }],
      // Allan y Daniel solo ven los reenvíos; los datos bancarios no les tocan.
      ...(role.canAttachGuide && !role.canCreate && !role.canApprove && !role.isAdmin ? { kind: "RESHIP" } : {}),
    },
    orderBy: { createdAt: "desc" },
    take: 300,
  });
  const ids = [...new Set(rows.flatMap((r) => [r.createdById, r.reviewedById, r.guideAttachedById]).filter((x): x is string => !!x && x !== "admin"))];
  const users = await prisma.user.findMany({ where: { id: { in: ids } }, select: { id: true, name: true } });
  const nameOf = (id: string | null) => (id === "admin" ? "Administrador" : id ? users.find((u) => u.id === id)?.name ?? "—" : null);
  return rows.map((r) => ({
    id: r.id,
    code: arrangementCode(r.number),
    kind: r.kind,
    status: r.status,
    originalGuide: r.originalGuide,
    clientName: r.clientName,
    city: r.city,
    reason: r.reason,
    evidenceUrl: r.evidenceUrl,
    orderNumber: r.orderNumber,
    freightAmount: r.freightAmount,
    paymentMethod: r.paymentMethod,
    guideNumber: r.guideNumber,
    guideAttachedAt: r.guideAttachedAt?.toISOString() ?? null,
    guideAttachedByName: nameOf(r.guideAttachedById),
    productName: r.productName,
    amount: r.amount,
    holderName: r.holderName,
    holderIdNumber: r.holderIdNumber,
    bankName: r.bankName,
    bankAccountType: r.bankAccountType,
    bankAccountNumber: r.bankAccountNumber,
    payoutProofUrl: r.payoutProofUrl,
    paidAt: r.paidAt?.toISOString() ?? null,
    createdById: r.createdById,
    createdByName: nameOf(r.createdById),
    createdAt: r.createdAt.toISOString(),
    reviewedByName: nameOf(r.reviewedById),
    reviewedAt: r.reviewedAt?.toISOString() ?? null,
    reviewNote: r.reviewNote,
    cancelledAt: r.cancelledAt?.toISOString() ?? null,
  }));
}

// ---- Pendientes de Inicio --------------------------------------------------

function plural(n: number, one: string, many: string) {
  return `${n} ${n === 1 ? one : many}`;
}

export async function getArrangementAdminPendingItems(): Promise<PendingItem[]> {
  const rows = await prisma.warrantyArrangement.findMany({ where: { status: { in: ["PAYMENT_REVIEW", "TO_PAY"] } }, select: { status: true, number: true } });
  const out: PendingItem[] = [];
  const verify = rows.filter((r) => r.status === "PAYMENT_REVIEW");
  const pay = rows.filter((r) => r.status === "TO_PAY");
  if (verify.length)
    out.push({ type: "arreglo_verificar_flete", icon: "💵", label: "Verificar pago de flete del dropshipper (reenvío)", meta: `${verify.map((r) => arrangementCode(r.number)).join(", ")} · no se despacha hasta que lo verifiques`, overdue: true, href: ARRANGEMENTS_ADMIN_URL });
  if (pay.length)
    out.push({ type: "arreglo_pagar_cliente", icon: "💸", label: "Pagar arreglo en dinero al dropshipper", meta: `${plural(pay.length, "arreglo aprobado", "arreglos aprobados")} por Bryan · cuenta principal`, overdue: true, href: ARRANGEMENTS_ADMIN_URL });
  return out;
}

export async function getArrangementPendingItems(userId: string): Promise<PendingItem[]> {
  const u = await prisma.user.findUnique({ where: { id: userId }, select: { username: true, isLeader: true, leadsDept: { select: { code: true } } } });
  if (!u) return [];
  const out: PendingItem[] = [];
  if (u.isLeader && u.leadsDept?.code === "MKT") {
    const n = await prisma.warrantyArrangement.count({ where: { status: "APPROVAL" } });
    if (n) out.push({ type: "arreglo_aprobar", icon: "🤝", label: "Arreglos en dinero por aprobar", meta: plural(n, "arreglo", "arreglos"), overdue: true, href: ARRANGEMENTS_AREA_URL });
  }
  if (GUIDE_USERNAMES.has(u.username ?? "") || (u.isLeader && u.leadsDept?.code === "INV")) {
    const rows = await prisma.warrantyArrangement.findMany({ where: { status: "PAYMENT_OK" }, select: { number: true, orderNumber: true } });
    if (rows.length) out.push({ type: "arreglo_generar_guia", icon: "📦", label: "Reenvío pagado por el dropshipper: genera la guía", meta: rows.map((r) => `${arrangementCode(r.number)} (pedido ${r.orderNumber})`).join(", "), overdue: true, href: ARRANGEMENTS_AREA_URL });
  }
  if (CREATOR_USERNAMES.has(u.username ?? "")) {
    const n = await prisma.warrantyArrangement.count({ where: { createdById: userId, status: "PAYMENT_REJECTED" } });
    if (n) out.push({ type: "arreglo_comprobante_rechazado", icon: "⚠️", label: "Pago de flete no verificado: sube el comprobante correcto", meta: plural(n, "reenvío", "reenvíos"), overdue: true, href: ARRANGEMENTS_AREA_URL });
  }
  return out;
}

// Para KPIs: guías de reenvío pagadas por el dropshipper (su flete no es
// pérdida nuestra) y arreglos en dinero pagados en un rango.
export async function getDropshipperPaidGuides(): Promise<Set<string>> {
  const rows = await prisma.warrantyArrangement.findMany({ where: { kind: "RESHIP", guideNumber: { not: null } }, select: { guideNumber: true } });
  return new Set(rows.map((r) => r.guideNumber!.toUpperCase()));
}

export async function getPaidCashSettlements(from: Date, to: Date): Promise<{ count: number; total: number }> {
  const agg = await prisma.warrantyArrangement.aggregate({ where: { kind: "CASH", status: "PAID", paidAt: { gte: from, lt: to } }, _sum: { amount: true }, _count: true });
  return { count: agg._count, total: agg._sum.amount ?? 0 };
}
