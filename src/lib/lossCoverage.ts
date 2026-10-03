import { prisma } from "@/lib/prisma";
import { bodegaUnitCost, resolveCostBasisForCatalogItems } from "@/lib/marketProduct";
import { DROPI_INSURANCE_DEFAULT } from "@/lib/dropiPricing";
import { currentGuayaquilMonth, getWarrantyCostMonth, monthRange, previousMonth } from "@/lib/warrantyInsights";

// Pedido del usuario 2026-10-03: ¿alcanza el 6% de seguro que lleva cada
// precio de Dropi para cubrir TODAS las pérdidas de mercadería del mes? Solo
// lo ven el admin y Nairoby, en KPIs financieros (nunca en Inicio).
// Pérdidas confirmadas por el usuario, todas al costo:
// 1. Garantías: producto reemplazado + fletes (igual que la tarjeta de Inicio).
// 2. Deterioro encontrado en bodega cerrado como "dar de baja" (WRITE_OFF).
// 3. Reclamos al proveedor rechazados: no cambió ni dio crédito (REJECTED).
// 4. Devoluciones que llegaron dañadas y no se pudieron arreglar ni se
//    devolvieron al proveedor.
// NO cuenta: lo arreglado en bodega, lo que el proveedor cambió o pagó con
// crédito, y lo que sigue en trámite. Cada pérdida cae en el mes en que se
// decidió (cierre del deterioro / revisión del daño).

export type LossCoverageMonth = {
  month: string;
  warranty: { total: number; productCost: number; freight: number; count: number };
  deterioro: { total: number; units: number };
  supplierRejected: { total: number; units: number };
  damagedReturns: { total: number; units: number };
  total: number;
  soldCost: number;
  reserve: number;
  // Qué % del costo vendido habría hecho falta para cubrir todo.
  neededPct: number | null;
};

const round2 = (n: number) => Math.round(n * 100) / 100;

export async function getLossCoverageMonth(month: string): Promise<LossCoverageMonth> {
  const { from, to } = monthRange(month);
  const [warranty, outflowItems, reentryItems] = await Promise.all([
    getWarrantyCostMonth(month),
    prisma.merchandiseOutflowItem.findMany({
      where: {
        resolvedAt: { gte: from, lt: to },
        OR: [{ resolution: "REJECTED" }, { resolution: "WRITE_OFF", batch: { reason: "DETERIORO" } }],
      },
      select: { resolution: true, catalogItemId: true, quantity: true, unitCostAtExchange: true, stockKardexEntry: { select: { unitCost: true } } },
    }),
    prisma.merchandiseReentryItem.findMany({
      where: { damageSolved: false, supplierClaimAt: null, damagedQty: { gt: 0 }, damageSolvedAt: { gte: from, lt: to } },
      select: { catalogItemId: true, damagedQty: true },
    }),
  ]);

  const ids = new Set<string>();
  for (const i of outflowItems) if (i.catalogItemId) ids.add(i.catalogItemId);
  for (const i of reentryItems) if (i.catalogItemId) ids.add(i.catalogItemId);
  const bases = await resolveCostBasisForCatalogItems([...ids]);
  const basisCost = (id: string | null) => {
    const b = id ? bases.get(id) : null;
    return b ? bodegaUnitCost(b.batchCost, b.freightCost, b.batchUnits) : 0;
  };

  const deterioro = { total: 0, units: 0 };
  const supplierRejected = { total: 0, units: 0 };
  for (const i of outflowItems) {
    // Costo real con el que salió del Kardex; si no hay, el de la compra
    // reclamada; si tampoco, el costo puesto en bodega de hoy.
    const unit = i.stockKardexEntry?.unitCost ?? i.unitCostAtExchange ?? basisCost(i.catalogItemId);
    const bucket = i.resolution === "REJECTED" ? supplierRejected : deterioro;
    bucket.total += unit * i.quantity;
    bucket.units += i.quantity;
  }
  const damagedReturns = { total: 0, units: 0 };
  for (const i of reentryItems) {
    damagedReturns.total += basisCost(i.catalogItemId) * i.damagedQty;
    damagedReturns.units += i.damagedQty;
  }

  const total = warranty.total + deterioro.total + supplierRejected.total + damagedReturns.total;
  return {
    month,
    warranty: { total: warranty.total, productCost: warranty.productCost, freight: warranty.freight, count: warranty.warranties },
    deterioro: { total: round2(deterioro.total), units: deterioro.units },
    supplierRejected: { total: round2(supplierRejected.total), units: supplierRejected.units },
    damagedReturns: { total: round2(damagedReturns.total), units: damagedReturns.units },
    total: round2(total),
    soldCost: warranty.soldCost,
    reserve: round2((warranty.soldCost * DROPI_INSURANCE_DEFAULT) / 100),
    neededPct: warranty.soldCost > 0 ? Math.round((total / warranty.soldCost) * 1000) / 10 : null,
  };
}

// Este mes y el anterior (los cortes empezaron el 21 de septiembre 2026).
export async function getLossCoverageOverview(): Promise<{ current: LossCoverageMonth; previous: LossCoverageMonth | null }> {
  const month = currentGuayaquilMonth();
  const prev = previousMonth(month);
  const [current, previous] = await Promise.all([getLossCoverageMonth(month), prev >= "2026-09" ? getLossCoverageMonth(prev) : Promise.resolve(null)]);
  return { current, previous };
}
