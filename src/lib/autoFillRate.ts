import { prisma } from "@/lib/prisma";
import { getCompiledLot, ecuadorDay } from "@/lib/fulfillmentGuides";
import { nextWorkingDay } from "@/lib/ecuadorHolidays";

// Confirmado 2026-09-25 con el usuario (punto por punto):
//   1. Desde la semana 2026-W40 (lunes 28 sept) el Fill Rate de Fulfillment
//      se llena con los cortes; las semanas anteriores quedan como Yair las
//      cargó a mano.
//   2. Guías totales = las guías de los PDF de los cortes enviados a
//      Inventario. Falta de stock = 1 guía por cada unidad que Daniel
//      confirmó que NO salió (la mayoría de pedidos lleva 1 unidad).
//   3. Preparadas y Generadas las escribía Yair UNA vez por semana. Pedido
//      del usuario 2026-10-12: se quitaron (casi siempre daban 0); en su
//      lugar la tarjeta muestra Manifiestos fuera de plazo y Guías
//      canceladas, que salen solas (dashboard.ts). Las semanas viejas que
//      sí las tenían conservan su valor.
//   Despachadas = guías − falta de stock − preparadas − generadas
//                 + ventas externas entregadas al motorizado.
//
// Pedido del usuario 2026-10-07 (lo notó Daniel): las ventas externas
// (VE-000X) también son pedidos despachados — desde la S40 cuenta 1 por cada
// venta que el equipo entregó al motorizado esa semana (deliveredAt, hora de
// Ecuador). Las garantías locales (GL) no cuentan. Ojo: este mismo número
// alimenta las comisiones por niveles (commissionTiers.ts).
export const AUTO_FILL_RATE_FROM_WEEK = "2026-W40";

// Área dueña del KPI "Pedidos despachados / Fill Rate". Era Fulfillment
// (FUL); desde 2026-10-01 Fulfillment se fusionó en INVESTOCK (INV) y las 40
// semanas guardadas se movieron con la misma fusión.
export const FILL_RATE_DEPT_CODE = "INV";

export function isoWeekOf(day: string): string {
  const d = new Date(`${day}T12:00:00Z`);
  const dow = d.getUTCDay() || 7;
  d.setUTCDate(d.getUTCDate() + 4 - dow);
  const yearStart = new Date(Date.UTC(d.getUTCFullYear(), 0, 1));
  const week = Math.ceil(((d.getTime() - yearStart.getTime()) / 86400000 + 1) / 7);
  return `${d.getUTCFullYear()}-W${String(week).padStart(2, "0")}`;
}

export function daysOfIsoWeek(week: string): string[] {
  const [y, w] = week.split("-W").map(Number);
  const jan4 = new Date(Date.UTC(y, 0, 4));
  const monday = new Date(jan4.getTime() - ((jan4.getUTCDay() || 7) - 1) * 86400000 + (w - 1) * 7 * 86400000);
  return Array.from({ length: 7 }, (_, i) => new Date(monday.getTime() + i * 86400000).toISOString().slice(0, 10));
}

export function isAutoFillRateWeek(week: string): boolean {
  return week >= AUTO_FILL_RATE_FROM_WEEK;
}

// Pedido de Daniel 2026-10-14: guías canceladas que Daniel o Allan
// confirmaron que retuvieron (CancelledGuideReport.retainedAt) — no salieron,
// así que no cuentan como despachadas. Se comparan en mayúsculas y sin
// espacios, igual que dispatchedDaily.ts.
export async function retainedGuideNumbers(): Promise<Set<string>> {
  const rows = await prisma.cancelledGuideReport.findMany({ where: { retainedAt: { not: null } }, select: { guideNumber: true } });
  return new Set(rows.map((r) => r.guideNumber.trim().toUpperCase()));
}

// Pedido del usuario 2026-10-14 (lo explicó Daniel con el lunes 12/10: DAFLOW
// decía 961, salieron 933). Dos cambios desde la S42:
//   1. La "falta de stock" (lo que Daniel confirmó que no salió del corte)
//      ya NO se resta de Pedidos despachados: mientras no termine el
//      inventario el stock del sistema no es confiable (restaba 117 cuando
//      en realidad faltaron 14). Se vuelve a restar cuando Daniel diga
//      (poner SUBTRACT_OUT_OF_STOCK en true). El Fill Rate la sigue usando.
//   2. Si se sube un corte cuando la transportadora de esa guía ya se fue
//      (ej. guías de Gintracom subidas a las 4 pm, Gintracom sale a las 3 pm),
//      la guía sale el siguiente día de trabajo y cuenta ese día.
export const SUBTRACT_OUT_OF_STOCK = false;
export const DISPATCH_RULES_FROM_WEEK = "2026-W42";

// Hora (Ecuador) en que se va cada transportadora — confirmado por Daniel
// 2026-10-15: Veloces 11:00, Urbano 13:00, Gintracom 15:00, Laar y
// Servientrega 17:00. El sábado solo vienen Veloces, Gintracom y
// Servientrega (hasta las 12:00); Urbano y Laar no vienen, así que sus guías
// del sábado salen el siguiente día de trabajo.
const CARRIER_LEAVES_AT: Record<string, string> = {
  VELOCES: "11:00",
  URBANO: "13:00",
  GINTRACOM: "15:00",
  LAAR: "17:00",
  SERVIENTREGA: "17:00",
};
const SATURDAY_LEAVES_AT: Record<string, string> = {
  VELOCES: "12:00",
  GINTRACOM: "12:00",
  SERVIENTREGA: "12:00",
  URBANO: "00:00",
  LAAR: "00:00",
};

// Día en que la guía realmente sale. Solo se mueve si el PDF se subió el
// mismo día del corte (un manifiesto atrasado se queda en su día) y después
// de la hora en que se fue su transportadora.
export function guideDispatchDay(lotDay: string, uploadedAt: Date, carrier: string): string {
  if (isoWeekOf(lotDay) < DISPATCH_RULES_FROM_WEEK) return lotDay;
  if (ecuadorDay(uploadedAt) !== lotDay) return lotDay;
  const saturday = new Date(`${lotDay}T12:00:00Z`).getUTCDay() === 6;
  const leavesAt = (saturday ? SATURDAY_LEAVES_AT : CARRIER_LEAVES_AT)[carrier.trim().toUpperCase()];
  if (!leavesAt) return lotDay;
  const uploadedTime = new Date(uploadedAt.getTime() - 5 * 3600000).toISOString().slice(11, 16);
  return uploadedTime > leavesAt ? nextWorkingDay(lotDay) : lotDay;
}

// Días de corte que pueden aportar guías a la semana: la semana y los 7
// días anteriores (un sábado por la tarde pasa al lunes; feriados largos).
export function lotDaysFeeding(week: string): string[] {
  const days = daysOfIsoWeek(week);
  const monday = new Date(`${days[0]}T12:00:00Z`).getTime();
  const before = Array.from({ length: 7 }, (_, i) => new Date(monday - (7 - i) * 86400000).toISOString().slice(0, 10));
  return [...before, ...days];
}

export function outOfStockSubtracted(week: string): boolean {
  return SUBTRACT_OUT_OF_STOCK || week < DISPATCH_RULES_FROM_WEEK;
}

// Lo que DAFLOW sabe solo de la semana: guías totales (por el día en que
// salen), falta de stock y guías retenidas que estaban en esos cortes.
export async function computeAutoCounts(week: string): Promise<{ guides: number; outOfStock: number; externalSales: number; retained: number; subtractOutOfStock: boolean }> {
  const days = daysOfIsoWeek(week);
  const daySet = new Set(days);
  const batches = await prisma.fulfillmentRequestBatch.findMany({
    where: { lot: { day: { in: lotDaysFeeding(week) }, status: { in: ["SENT", "CLOSED"] } } },
    select: { requestedAt: true, lot: { select: { day: true } }, guides: { select: { guideNumber: true, carrier: true } } },
  });
  const retainedSet = await retainedGuideNumbers();
  let guides = 0;
  let retained = 0;
  for (const b of batches) {
    if (!b.lot) continue;
    for (const g of b.guides) {
      if (!daySet.has(guideDispatchDay(b.lot.day, b.requestedAt, g.carrier))) continue;
      guides++;
      if (retainedSet.has(g.guideNumber.trim().toUpperCase())) retained++;
    }
  }
  const lots = await prisma.fulfillmentLot.findMany({
    where: { day: { in: days }, status: { in: ["SENT", "CLOSED"] } },
    select: { id: true },
  });
  let outOfStock = 0;
  for (const { id } of lots) {
    const lot = await getCompiledLot(id);
    if (!lot) continue;
    for (const p of lot.picking) {
      if (p.confirmedAt && p.confirmedQty !== null && p.confirmedQty < p.needed) outOfStock += p.needed - p.confirmedQty;
    }
  }
  return {
    guides,
    outOfStock: Math.min(outOfStock, guides),
    externalSales: await countDeliveredExternalSales(days),
    retained,
    subtractOutOfStock: outOfStockSubtracted(week),
  };
}

// Ventas externas entregadas al motorizado en esos días (hora de Ecuador).
async function countDeliveredExternalSales(days: string[]): Promise<number> {
  const from = new Date(`${days[0]}T00:00:00-05:00`);
  const to = new Date(`${days[days.length - 1]}T23:59:59.999-05:00`);
  return prisma.externalSale.count({
    where: { kind: "SALE", deletedAt: null, deliveredAt: { gte: from, lte: to } },
  });
}

// Despachadas y no despachadas a partir de lo automático + lo que escribió Yair.
// Las retenidas se quitan del todo (no son despachadas ni fallas del Fill Rate).
// Desde la S42 la falta de stock no se resta (ver SUBTRACT_OUT_OF_STOCK).
export function fillRateNumbers(counts: { guides: number; outOfStock: number; externalSales: number; retained?: number; subtractOutOfStock?: boolean }, prepared: number, generated: number) {
  const subtracted = counts.subtractOutOfStock === false ? 0 : counts.outOfStock;
  const value = Math.max(0, counts.guides - (counts.retained ?? 0) - subtracted - prepared - generated) + counts.externalSales;
  return { value, outOfStock: counts.outOfStock, notDispatched: counts.outOfStock + prepared + generated };
}

// Recalcula la semana del día dado conservando lo que el líder escribió
// (preparadas/generadas) y la justificación. Se llama cada vez que un corte
// se envía a Inventario o Daniel confirma algo — nunca rompe el flujo si falla.
export async function recomputeAutoFillRate(day: string): Promise<void> {
  const week = isoWeekOf(day);
  if (!isAutoFillRateWeek(week)) return;
  const dept = await prisma.department.findFirst({ where: { code: FILL_RATE_DEPT_CODE }, select: { id: true } });
  if (!dept) return;
  const existing = await prisma.weeklyMetricRecord.findUnique({
    where: { deptId_week: { deptId: dept.id, week } },
    select: { prepared: true, generated: true },
  });
  const prepared = existing?.prepared ?? 0;
  const generated = existing?.generated ?? 0;
  const nums = fillRateNumbers(await computeAutoCounts(week), prepared, generated);
  await prisma.weeklyMetricRecord.upsert({
    where: { deptId_week: { deptId: dept.id, week } },
    update: { ...nums, prepared, generated },
    create: { deptId: dept.id, week, ...nums, prepared, generated },
  });
}

// Barrido diario (cron de inventario): recalcula la semana actual y la
// anterior. Así las semanas ya guardadas toman lo que cambió la fórmula
// (ej. ventas externas desde la S40) y nada queda desactualizado si un
// recálculo puntual falló.
export async function recomputeRecentAutoFillRate(): Promise<void> {
  const today = ecuadorDay(new Date());
  const weekAgo = ecuadorDay(new Date(Date.now() - 7 * 86400000));
  await recomputeAutoFillRate(weekAgo);
  await recomputeAutoFillRate(today);
}
