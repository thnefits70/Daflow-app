import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { canSubmitPurchaseRequests } from "@/lib/guards";
import { effectiveUnitCost } from "@/lib/purchases";
import type { PurchaseRequestStatus } from "@/generated/prisma/client";

const PRICED_STATUSES: PurchaseRequestStatus[] = ["APPROVED", "PAID", "RECEIVED"];

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
// historial general de effectiveUnitCost/purchases.ts, que es global al
// insumo) y se ordena del más barato al más caro para decidir a quién
// comprarle de un vistazo.
export async function GET(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  if (!(await canSubmitPurchaseRequests())) return NextResponse.json({ error: "No autorizado." }, { status: 403 });
  const { id } = await params;

  const rows = await prisma.purchaseRequest.findMany({
    where: { catalogItemId: id, status: { in: PRICED_STATUSES } },
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

  return NextResponse.json(suppliers);
}
