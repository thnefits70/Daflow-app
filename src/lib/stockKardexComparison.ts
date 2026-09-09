import { prisma } from "@/lib/prisma";
import { getCurrentStock } from "@/lib/stockKardex";

export type StockComparisonRow = {
  catalogItemId: string;
  productName: string;
  productCode: string;
  justStock: number;
  investockStock: number;
  difference: number;
};

// Fase 3 (INVESTOCK) — confirmado 2026-09-09: el puente que faltaba entre
// el export semanal de Just (InventoryProductSnapshot.productCode, un texto
// suelto hasta ahora) y el catálogo real (PurchaseCatalogItem.justCode).
// Se calcula justo después de que Daniel guarda el export semanal — mismo
// momento donde ya se guarda InventoryProductSnapshot, sin tocar ese flujo.
// Une por código EXACTO (ambos vienen del mismo sistema Just/Provedix, no
// hace falta coincidencia difusa como sí la necesita el nombre).
export async function computeAndSaveStockComparison(deptId: string, period: string): Promise<StockComparisonRow[]> {
  const snapshotRows = await prisma.inventoryProductSnapshot.findMany({
    where: { deptId, period },
    select: { productCode: true, stock: true },
  });
  if (snapshotRows.length === 0) return [];

  const codes = snapshotRows.map((r) => r.productCode.trim()).filter(Boolean);
  const catalogItems = await prisma.purchaseCatalogItem.findMany({
    where: { justCode: { in: codes } },
    select: { id: true, name: true, justCode: true },
  });
  const byCode = new Map(catalogItems.map((c) => [c.justCode!, c]));

  const results: StockComparisonRow[] = [];
  for (const snap of snapshotRows) {
    const catalogItem = byCode.get(snap.productCode.trim());
    if (!catalogItem) continue; // no reconocido en el catálogo real — no hay con qué comparar
    const { balance } = await getCurrentStock(catalogItem.id);
    results.push({
      catalogItemId: catalogItem.id,
      productName: catalogItem.name,
      productCode: snap.productCode,
      justStock: snap.stock,
      investockStock: balance,
      difference: snap.stock - balance,
    });
  }

  await prisma.$transaction([
    prisma.stockKardexJustComparison.deleteMany({ where: { period } }),
    prisma.stockKardexJustComparison.createMany({
      data: results.map((r) => ({
        period,
        catalogItemId: r.catalogItemId,
        justStock: r.justStock,
        investockStock: r.investockStock,
        difference: r.difference,
      })),
    }),
  ]);

  return results.sort((a, b) => Math.abs(b.difference) - Math.abs(a.difference));
}

export async function getStockComparisonForPeriod(period: string): Promise<StockComparisonRow[]> {
  const rows = await prisma.stockKardexJustComparison.findMany({
    where: { period },
    include: { catalogItem: { select: { name: true, justCode: true } } },
  });
  return rows
    .map((r) => ({
      catalogItemId: r.catalogItemId,
      productName: r.catalogItem.name,
      productCode: r.catalogItem.justCode ?? "",
      justStock: r.justStock,
      investockStock: r.investockStock,
      difference: r.difference,
    }))
    .sort((a, b) => Math.abs(b.difference) - Math.abs(a.difference));
}
