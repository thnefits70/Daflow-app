import { prisma } from "@/lib/prisma";
import { getCurrentStockByItemIds } from "@/lib/stockKardex";
import { computeMarketProductSalePrice, pickPrimarySupplierPrice, DROPI_MARGIN_DEFAULT } from "@/lib/marketProduct";
import type { MarketProductBodega } from "@/generated/prisma/client";

// Confirmado 2026-09-17, pedido explícito del usuario: "ventas" y "costo de
// ventas" automáticos por mes, calculados desde INVESTOCK — SOLO de
// referencia junto a lo que Nairoby sigue subiendo a mano cada mes en KPIs
// Financieros, nunca lo reemplaza (mismo criterio que Just vs INVESTOCK en
// Stock Actual). Dividido por marca (Provedix/Damián/Shanghai) porque así
// sube Nairoby su plantilla — un producto sin marca todavía asignada
// (Daniel está etiquetando el catálogo) cae en "SIN_MARCA".
//
// No toda salida de bodega es una venta — solo 3 de los motivos:
//  - VENTA_EXTERNA: precio real, ya guardado (ExternalSaleItem.unitPrice).
//  - COMPRA_PERSONAL: precio real, lo define Nairoby (PersonalPurchaseItem.itemTotal).
//  - DESPACHO (Dropi): DAFLOW no ve el precio real ahí — se usa el "Precio
//    Dropi" calculado (costo real + el margen ya ajustado en Análisis de
//    Mercado si el producto pasó por ahí, si no 20% por defecto) como
//    ESTIMADO, nunca el número exacto — confirmado con el usuario que Nairoby
//    ajusta esto a mano según competencia/demanda, algo que el sistema no
//    puede anticipar solo.
// Garantía/Deterioro/Cambio de proveedor nunca cuentan como venta.

export type MarcaBucketKey = MarketProductBodega | "SIN_MARCA";
export const MARCA_BUCKET_KEYS: MarcaBucketKey[] = ["MKT_PROVEDIX", "MKT_DAMIAN", "MKT_SHANGHAI", "SIN_MARCA"];

export type SalesEstimateBucket = { ventas: number; costoVentas: number };
export type SalesEstimateRow = Record<MarcaBucketKey, SalesEstimateBucket>;

function emptyRow(): SalesEstimateRow {
  return {
    MKT_PROVEDIX: { ventas: 0, costoVentas: 0 },
    MKT_DAMIAN: { ventas: 0, costoVentas: 0 },
    MKT_SHANGHAI: { ventas: 0, costoVentas: 0 },
    SIN_MARCA: { ventas: 0, costoVentas: 0 },
  };
}

function monthRange(period: string): { start: Date; end: Date } {
  const [y, m] = period.split("-").map(Number);
  return { start: new Date(Date.UTC(y, m - 1, 1)), end: new Date(Date.UTC(y, m, 0, 23, 59, 59, 999)) };
}

function periodOf(date: Date): string {
  return `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, "0")}`;
}

const SALE_REASONS = new Set(["DESPACHO", "VENTA_EXTERNA", "COMPRA_PERSONAL"]);

export async function getAutoSalesEstimateByMonth(periods: string[]): Promise<Map<string, SalesEstimateRow>> {
  if (periods.length === 0) return new Map();
  const periodSet = new Set(periods);
  const ranges = periods.map((p) => monthRange(p));
  const minStart = new Date(Math.min(...ranges.map((r) => r.start.getTime())));
  const maxEnd = new Date(Math.max(...ranges.map((r) => r.end.getTime())));

  const entries = await prisma.stockKardexEntry.findMany({
    where: { type: "OUT", occurredAt: { gte: minStart, lte: maxEnd }, merchandiseOutflowItemId: { not: null } },
    select: { catalogItemId: true, quantity: true, unitCost: true, occurredAt: true, merchandiseOutflowItemId: true },
  });
  const result = new Map<string, SalesEstimateRow>();
  if (entries.length === 0) return result;

  const outflowItemIds = [...new Set(entries.map((e) => e.merchandiseOutflowItemId!))];
  const [outflowItems, catalogItems, proposals, avgCostMap] = await Promise.all([
    prisma.merchandiseOutflowItem.findMany({
      where: { id: { in: outflowItemIds } },
      select: {
        id: true,
        batch: {
          select: {
            reason: true,
            personalPurchaseItem: { select: { itemTotal: true } },
            externalSale: { select: { items: { select: { catalogItemId: true, unitPrice: true } } } },
          },
        },
      },
    }),
    prisma.purchaseCatalogItem.findMany({
      where: { id: { in: [...new Set(entries.map((e) => e.catalogItemId))] } },
      select: { id: true, bodega: true },
    }),
    prisma.marketProductProposal.findMany({
      where: { catalogItemId: { in: [...new Set(entries.map((e) => e.catalogItemId))] } },
      include: { supplierPrices: true },
    }),
    getCurrentStockByItemIds([...new Set(entries.map((e) => e.catalogItemId))]),
  ]);

  const outflowById = new Map(outflowItems.map((o) => [o.id, o]));
  const bodegaByCatalogItemId = new Map(catalogItems.map((c) => [c.id, c.bodega]));
  const proposalByCatalogItemId = new Map(
    proposals
      .filter((p) => p.catalogItemId && pickPrimarySupplierPrice(p.supplierPrices))
      .map((p) => {
        const supplier = pickPrimarySupplierPrice(p.supplierPrices)!;
        return [
          p.catalogItemId!,
          {
            batchCost: supplier.batchCost,
            batchUnits: supplier.batchUnits,
            freightCost: supplier.freightCost,
            insuranceRatePercent: p.insuranceRatePercent,
            fulfillmentCost: p.fulfillmentCost,
            marginPercent: p.marginPercent,
          },
        ] as const;
      })
  );

  function estimatedDropiUnitPrice(catalogItemId: string): number | null {
    const proposalBase = proposalByCatalogItemId.get(catalogItemId);
    if (proposalBase) return computeMarketProductSalePrice(proposalBase);
    const avgCost = avgCostMap.get(catalogItemId)?.avgCost ?? 0;
    if (avgCost <= 0) return null;
    return computeMarketProductSalePrice({
      batchCost: avgCost, batchUnits: 1, freightCost: null, insuranceRatePercent: 6, fulfillmentCost: 0.75, marginPercent: DROPI_MARGIN_DEFAULT,
    });
  }

  for (const e of entries) {
    const period = periodOf(e.occurredAt);
    if (!periodSet.has(period)) continue;

    const outflow = outflowById.get(e.merchandiseOutflowItemId!);
    const reason = outflow?.batch.reason;
    if (!reason || !SALE_REASONS.has(reason)) continue; // Garantía/Deterioro/Cambio de proveedor — no es venta

    let row = result.get(period);
    if (!row) { row = emptyRow(); result.set(period, row); }
    const bucket = row[bodegaByCatalogItemId.get(e.catalogItemId) ?? "SIN_MARCA"];
    bucket.costoVentas += e.quantity * (e.unitCost ?? 0);

    if (reason === "VENTA_EXTERNA") {
      const match = outflow!.batch.externalSale?.items.find((i) => i.catalogItemId === e.catalogItemId);
      if (match) bucket.ventas += match.unitPrice * e.quantity;
    } else if (reason === "COMPRA_PERSONAL") {
      bucket.ventas += outflow!.batch.personalPurchaseItem?.itemTotal ?? 0;
    } else {
      const price = estimatedDropiUnitPrice(e.catalogItemId);
      if (price !== null) bucket.ventas += price * e.quantity;
    }
  }

  return result;
}
