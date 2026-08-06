import { prisma } from "@/lib/prisma";
import type { PurchaseRequestStatus } from "@/generated/prisma/client";

// Estados que cuentan como "compra real" para el historial de precio — no
// las que todavía están pendientes de aprobar (no son un precio confirmado
// todavía) ni las rechazadas.
const PRICED_STATUSES: PurchaseRequestStatus[] = ["APPROVED", "PAID", "RECEIVED"];

// Confirmado 2026-08-05: código correlativo para toda solicitud de compra
// (SC-001, SC-002...) — una sola numeración compartida por TODO el módulo,
// sin importar quién la suba (hoy Nairoby o Bryan) — para la auditoría
// semestral de Finanzas. Se asigna UNA vez por grupo (no por fila), vía el
// contador único en PlatformSettings, incrementado dentro de una transacción
// para que nunca se repita aunque lleguen dos solicitudes al mismo tiempo.
export async function nextPurchaseRequestNumber(): Promise<number> {
  const updated = await prisma.platformSettings.update({
    where: { id: "singleton" },
    data: { lastPurchaseRequestNumber: { increment: 1 } },
  });
  return updated.lastPurchaseRequestNumber;
}

export function formatPurchaseRequestCode(requestNumber: number): string {
  return `SC-${String(requestNumber).padStart(3, "0")}`;
}

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

export type SupplierPricePoint = { date: string; unitCost: number; quantity: number; status: PurchaseRequestStatus };
export type SupplierPriceHistory = {
  supplierId: string;
  supplierName: string;
  latest: number;
  min: number;
  max: number;
  avg: number;
  count: number;
  history: SupplierPricePoint[];
};

// Confirmado 2026-07-31: para un mismo insumo, cada proveedor tiene su propia
// serie de precios en el tiempo — se agrupa por proveedor (no se mezcla el
// historial general de effectiveUnitCost, que es global al insumo) y se
// ordena del más barato al más caro (por el precio más reciente pagado) para
// decidir a quién comprarle de un vistazo. Reutilizado tanto por la pantalla
// "Comparar precios" como, desde 2026-08-06, por el formulario de solicitud
// (para sugerir el proveedor más barato) y por la validación server-side que
// exige justificar si se elige uno que no lo es.
export async function getCatalogItemSupplierComparison(catalogItemId: string): Promise<SupplierPriceHistory[]> {
  const rows = await prisma.purchaseRequest.findMany({
    where: { catalogItemId, status: { in: PRICED_STATUSES } },
    select: {
      unitCost: true,
      quantity: true,
      shippingIncluded: true,
      shippingCostTotal: true,
      requestedAt: true,
      status: true,
      supplier: { select: { id: true, name: true } },
    },
    orderBy: { requestedAt: "asc" },
  });

  const bySupplier = new Map<string, { supplierId: string; supplierName: string; history: SupplierPricePoint[] }>();
  for (const r of rows) {
    const key = r.supplier.id;
    if (!bySupplier.has(key)) bySupplier.set(key, { supplierId: r.supplier.id, supplierName: r.supplier.name, history: [] });
    bySupplier.get(key)!.history.push({
      date: r.requestedAt.toISOString(),
      unitCost: effectiveUnitCost({ unitCost: r.unitCost, quantity: r.quantity, shippingIncluded: r.shippingIncluded, shippingCostTotal: r.shippingCostTotal }),
      quantity: r.quantity,
      status: r.status,
    });
  }

  const suppliers: SupplierPriceHistory[] = [...bySupplier.values()].map((s) => {
    const costs = s.history.map((h) => h.unitCost);
    return {
      ...s,
      latest: costs[costs.length - 1],
      min: Math.min(...costs),
      max: Math.max(...costs),
      avg: costs.reduce((a, b) => a + b, 0) / costs.length,
      count: costs.length,
    };
  });
  suppliers.sort((a, b) => a.latest - b.latest);
  return suppliers;
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
