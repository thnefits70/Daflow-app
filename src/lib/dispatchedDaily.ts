import { prisma } from "@/lib/prisma";
import { getCompiledLot, ecuadorDay, NO_BRAND } from "@/lib/fulfillmentGuides";
import { guideBrandsOf } from "@/lib/guideBrands";
import { brandLabel, sortBrands } from "@/lib/brandLabels";
import { daysOfIsoWeek, isAutoFillRateWeek, FILL_RATE_DEPT_CODE } from "@/lib/autoFillRate";

// Pedido de Daniel 2026-10-13: al hacer clic en una semana de "Pedidos
// despachados", el mismo número desglosado por día — guías de los cortes por
// marca, menos la falta de stock, más las ventas externas entregadas — para
// ver qué está sumando (p.ej. guías que después se reportaron canceladas,
// que se muestran aparte, solo informativo). Lo ve todo el equipo, igual
// que el gráfico (Bryan ya no lo ve en la pizarra). Mismo cálculo que
// computeAutoCounts (autoFillRate.ts), repartido por día.
export type DispatchedDay = {
  day: string;
  brands: { label: string; value: number }[];
  guides: number;
  outOfStock: number;
  externalSales: number;
  dispatched: number;
  cancelledInCut: number;
  cancelledReported: number;
};

export type DispatchedDailyBreakdown = {
  week: string;
  days: DispatchedDay[];
  // Semanas viejas (S40/S41) que todavía tenían Preparadas/Generadas escritas
  // a mano: se restan del total de la semana, no se pueden repartir por día.
  manualWeekly: number;
  weekTotal: number | null;
};

export async function getDispatchedDailyBreakdown(week: string): Promise<DispatchedDailyBreakdown | null> {
  if (!isAutoFillRateWeek(week)) return null;
  const days = daysOfIsoWeek(week);
  const from = new Date(`${days[0]}T00:00:00-05:00`);
  const to = new Date(`${days[6]}T23:59:59.999-05:00`);

  const [batches, lots, sales, cancelled, dept] = await Promise.all([
    prisma.fulfillmentRequestBatch.findMany({
      where: { lot: { day: { in: days }, status: { in: ["SENT", "CLOSED"] } } },
      select: {
        source: true,
        lot: { select: { day: true } },
        guides: { select: { guideNumber: true, codes: true, manifestFile: true } },
        items: { select: { sourceCode: true, fromComboCode: true, catalogItem: { select: { bodega: true } } } },
      },
    }),
    prisma.fulfillmentLot.findMany({ where: { day: { in: days }, status: { in: ["SENT", "CLOSED"] } }, select: { id: true, day: true } }),
    prisma.externalSale.findMany({
      where: { kind: "SALE", deletedAt: null, deliveredAt: { gte: from, lte: to } },
      select: { deliveredAt: true },
    }),
    prisma.cancelledGuideReport.findMany({
      where: { createdAt: { gte: from, lte: to } },
      select: { guideNumber: true, createdAt: true },
    }),
    prisma.department.findFirst({ where: { code: FILL_RATE_DEPT_CODE }, select: { id: true } }),
  ]);

  const brandOf = await guideBrandsOf(batches);
  const byDay = new Map<string, { day: DispatchedDay; brandCounts: Record<string, number> }>();
  for (const day of days) {
    byDay.set(day, {
      day: { day, brands: [], guides: 0, outOfStock: 0, externalSales: 0, dispatched: 0, cancelledInCut: 0, cancelledReported: 0 },
      brandCounts: {},
    });
  }

  // Guía → día del corte, para saber si una guía cancelada estaba sumando.
  const guideDay = new Map<string, string>();
  for (const b of batches) {
    const entry = b.lot ? byDay.get(b.lot.day) : undefined;
    if (!entry) continue;
    for (const g of b.guides) {
      const brand = brandOf.get(g.guideNumber) ?? NO_BRAND;
      entry.brandCounts[brand] = (entry.brandCounts[brand] ?? 0) + 1;
      entry.day.guides++;
      guideDay.set(g.guideNumber.trim().toUpperCase(), entry.day.day);
    }
  }

  for (const { id, day } of lots) {
    const lot = await getCompiledLot(id);
    const entry = byDay.get(day);
    if (!lot || !entry) continue;
    for (const p of lot.picking) {
      if (p.confirmedAt && p.confirmedQty !== null && p.confirmedQty < p.needed) entry.day.outOfStock += p.needed - p.confirmedQty;
    }
  }

  for (const s of sales) {
    const entry = byDay.get(ecuadorDay(s.deliveredAt!));
    if (entry) entry.day.externalSales++;
  }

  for (const c of cancelled) {
    const reported = byDay.get(ecuadorDay(c.createdAt));
    if (reported) reported.day.cancelledReported++;
    const cutDay = guideDay.get(c.guideNumber.trim().toUpperCase());
    if (cutDay) byDay.get(cutDay)!.day.cancelledInCut++;
  }

  const out: DispatchedDay[] = [];
  for (const { day: d, brandCounts } of byDay.values()) {
    d.brands = sortBrands(Object.keys(brandCounts)).map((b) => ({ label: brandLabel(b), value: brandCounts[b] }));
    d.outOfStock = Math.min(d.outOfStock, d.guides);
    d.dispatched = d.guides - d.outOfStock + d.externalSales;
    out.push(d);
  }

  const record = dept
    ? await prisma.weeklyMetricRecord.findUnique({
        where: { deptId_week: { deptId: dept.id, week } },
        select: { value: true, prepared: true, generated: true },
      })
    : null;
  return {
    week,
    days: out,
    manualWeekly: (record?.prepared ?? 0) + (record?.generated ?? 0),
    weekTotal: record?.value ?? null,
  };
}
