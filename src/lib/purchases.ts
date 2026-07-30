import { prisma } from "@/lib/prisma";
import type { PurchaseRequestStatus } from "@/generated/prisma/client";

// Estados que cuentan como "compra real" para el historial de precio — no
// las que todavía están pendientes de aprobar (no son un precio confirmado
// todavía) ni las rechazadas.
const PRICED_STATUSES: PurchaseRequestStatus[] = ["APPROVED", "PAID", "RECEIVED"];

// Confirmado 2026-07-30: el costo por unidad que se compara contra el
// historial ya incluye el envío cuando el proveedor lo cobra aparte — así
// nunca se puede esconder un sobreprecio repartiéndolo entre "producto" y
// "flete" por separado.
export function effectiveUnitCost(req: { unitCost: number; quantity: number; shippingIncluded: boolean; shippingCostTotal: number | null }) {
  if (req.shippingIncluded || !req.shippingCostTotal || req.quantity === 0) return req.unitCost;
  return req.unitCost + req.shippingCostTotal / req.quantity;
}

export type PriceHistoryStats = {
  count: number;
  min: number | null;
  avg: number | null;
  max: number | null;
  last3Avg: number | null;
};

export async function getCatalogItemPriceStats(catalogItemId: string): Promise<PriceHistoryStats> {
  const rows = await prisma.purchaseRequest.findMany({
    where: { catalogItemId, status: { in: PRICED_STATUSES } },
    select: { unitCost: true, quantity: true, shippingIncluded: true, shippingCostTotal: true, requestedAt: true },
    orderBy: { requestedAt: "desc" },
  });
  if (rows.length === 0) return { count: 0, min: null, avg: null, max: null, last3Avg: null };

  const costs = rows.map(effectiveUnitCost);
  const last3 = costs.slice(0, 3);
  return {
    count: rows.length,
    min: Math.min(...costs),
    max: Math.max(...costs),
    avg: costs.reduce((a, b) => a + b, 0) / costs.length,
    last3Avg: last3.reduce((a, b) => a + b, 0) / last3.length,
  };
}

// Historial de costo de envío por unidad para un transportista — mismo
// principio que el del producto, pero aparte, para detectar sobreprecio de
// flete específicamente (ej. cobrar de más por traer poca cantidad).
export async function getCarrierShippingStats(carrierId: string) {
  const rows = await prisma.purchaseRequest.findMany({
    where: { carrierId, shippingIncluded: false, shippingCostTotal: { not: null }, status: { in: PRICED_STATUSES } },
    select: { shippingCostTotal: true, quantity: true, requestedAt: true },
    orderBy: { requestedAt: "asc" },
  });
  return rows
    .filter((r) => r.quantity > 0 && r.shippingCostTotal !== null)
    .map((r) => ({ requestedAt: r.requestedAt.toISOString(), perUnit: r.shippingCostTotal! / r.quantity }));
}

export type StalePurchaseRequestPush = { ownerId: string; title: string; body: string; url: string };

// Confirmado 2026-07-30: si una solicitud lleva más de 24 horas sin avanzar
// a la siguiente etapa, se avisa a quien le corresponde esa etapa — corre
// dentro del mismo cron diario de "Pendientes" (no hay infraestructura para
// algo más frecuente en el plan actual de Vercel), y se vuelve a avisar
// cada día que sigue sin resolverse, mismo espíritu que el resto de esa
// notificación diaria.
export async function getStalePurchaseRequestPushes(): Promise<StalePurchaseRequestPush[]> {
  const cutoff = new Date(Date.now() - 24 * 60 * 60 * 1000);
  const pushes: StalePurchaseRequestPush[] = [];

  const [pendingApproval, approvedUnpaid, paidUnreceived, invLeader, finLeader] = await Promise.all([
    prisma.purchaseRequest.findMany({
      where: { status: "PENDING_APPROVAL", requestedAt: { lt: cutoff } },
      select: { id: true, totalCost: true, catalogItem: { select: { name: true } } },
    }),
    prisma.purchaseRequest.findMany({
      where: { status: "APPROVED", reviewedAt: { lt: cutoff } },
      select: { id: true, totalCost: true, catalogItem: { select: { name: true } } },
    }),
    prisma.purchaseRequest.findMany({
      where: { status: "PAID", paidAt: { lt: cutoff } },
      select: { id: true, totalCost: true, catalogItem: { select: { name: true } } },
    }),
    prisma.user.findFirst({ where: { isLeader: true, leadsDept: { code: "INV" } }, select: { id: true } }),
    prisma.user.findFirst({ where: { isLeader: true, leadsDept: { code: "FIN" } }, select: { id: true } }),
  ]);

  for (const r of pendingApproval) {
    pushes.push({
      ownerId: "admin",
      title: "⏰ Solicitud sin aprobar hace más de 24h",
      body: `${r.catalogItem.name} — $${r.totalCost.toFixed(2)}`,
      url: "/admin",
    });
  }
  for (const r of approvedUnpaid) {
    const body = `${r.catalogItem.name} — $${r.totalCost.toFixed(2)} aprobado hace más de 24h, todavía sin pagar`;
    pushes.push({ ownerId: "admin", title: "⏰ Falta pagar una compra aprobada", body, url: "/admin" });
    if (finLeader) pushes.push({ ownerId: finLeader.id, title: "⏰ Falta pagar una compra aprobada", body, url: "/area/workspace" });
  }
  for (const r of paidUnreceived) {
    const body = `${r.catalogItem.name} — pagado hace más de 24h, Inventario todavía no confirma que llegó`;
    pushes.push({ ownerId: "admin", title: "⏰ Falta confirmar que llegó una compra", body, url: "/admin" });
    if (invLeader) pushes.push({ ownerId: invLeader.id, title: "⏰ Falta confirmar que llegó una compra", body, url: "/area/workspace" });
  }

  return pushes;
}
