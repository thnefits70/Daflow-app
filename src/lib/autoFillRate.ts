import { prisma } from "@/lib/prisma";
import { getCompiledLot } from "@/lib/fulfillmentGuides";

// Confirmado 2026-09-25 con el usuario (punto por punto):
//   1. Desde la semana 2026-W40 (lunes 28 sept) el Fill Rate de Fulfillment
//      se llena SOLO con los cortes; las semanas anteriores quedan como Yair
//      las cargó a mano.
//   2. Desde esa semana Yair ya no lo llena a mano (la API lo rechaza) —
//      solo escribe la justificación cuando baja de 95%, como siempre.
//   3. Guías totales = las guías de los PDF de los cortes enviados a
//      Inventario. Falta de stock = 1 guía por cada unidad que Daniel
//      confirmó que NO salió (la mayoría de pedidos lleva 1 unidad).
//      Preparadas y Generadas quedan en 0 hasta tener el reporte de estados
//      de Dropi (DAFLOW no ve cuándo el courier se lleva el paquete).
export const AUTO_FILL_RATE_FROM_WEEK = "2026-W40";

export function isoWeekOf(day: string): string {
  const d = new Date(`${day}T12:00:00Z`);
  const dow = d.getUTCDay() || 7;
  d.setUTCDate(d.getUTCDate() + 4 - dow);
  const yearStart = new Date(Date.UTC(d.getUTCFullYear(), 0, 1));
  const week = Math.ceil(((d.getTime() - yearStart.getTime()) / 86400000 + 1) / 7);
  return `${d.getUTCFullYear()}-W${String(week).padStart(2, "0")}`;
}

function daysOfIsoWeek(week: string): string[] {
  const [y, w] = week.split("-W").map(Number);
  const jan4 = new Date(Date.UTC(y, 0, 4));
  const monday = new Date(jan4.getTime() - ((jan4.getUTCDay() || 7) - 1) * 86400000 + (w - 1) * 7 * 86400000);
  return Array.from({ length: 7 }, (_, i) => new Date(monday.getTime() + i * 86400000).toISOString().slice(0, 10));
}

export function isAutoFillRateWeek(week: string): boolean {
  return week >= AUTO_FILL_RATE_FROM_WEEK;
}

// Recalcula la semana del día dado. Se llama cada vez que un corte se envía
// a Inventario o Daniel confirma algo — nunca rompe el flujo si falla.
export async function recomputeAutoFillRate(day: string): Promise<void> {
  const week = isoWeekOf(day);
  if (!isAutoFillRateWeek(week)) return;
  const dept = await prisma.department.findFirst({ where: { code: "FUL" }, select: { id: true } });
  if (!dept) return;

  const lots = await prisma.fulfillmentLot.findMany({
    where: { day: { in: daysOfIsoWeek(week) }, status: { in: ["SENT", "CLOSED"] } },
    select: { id: true },
  });
  let guides = 0;
  let outOfStock = 0;
  for (const { id } of lots) {
    const lot = await getCompiledLot(id);
    if (!lot) continue;
    guides += await prisma.fulfillmentRequestGuide.count({ where: { batch: { lotId: id } } });
    for (const p of lot.picking) {
      if (p.confirmedAt && p.confirmedQty !== null && p.confirmedQty < p.needed) outOfStock += p.needed - p.confirmedQty;
    }
  }
  outOfStock = Math.min(outOfStock, guides);
  const value = guides - outOfStock;

  // Solo los números — la justificación que haya escrito Yair se conserva.
  await prisma.weeklyMetricRecord.upsert({
    where: { deptId_week: { deptId: dept.id, week } },
    update: { value, prepared: 0, generated: 0, outOfStock, notDispatched: outOfStock },
    create: { deptId: dept.id, week, value, prepared: 0, generated: 0, outOfStock, notDispatched: outOfStock },
  });
}
