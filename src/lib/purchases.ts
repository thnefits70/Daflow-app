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
