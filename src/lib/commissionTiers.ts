// Comisiones de equipo por niveles — diseñado en conversación larga con el
// usuario 2026-08-14, no re-derivar. Mismo espíritu que payrollCalc.ts:
// nunca se guarda un resultado derivado, siempre se recalcula desde los
// datos crudos (WeeklyMetricRecord).
import { prisma } from "@/lib/prisma";
import { isFixedHoliday } from "@/lib/recognition";

// Mismo cálculo de lunes-de-semana-ISO que ya usa pendingTasks.ts (no
// exportado ahí, así que se reimplementa acá — cada archivo tiene la suya).
function mondayOfIsoWeek(week: string): Date {
  const [yearStr, wStr] = week.split("-W");
  const year = Number(yearStr);
  const weekNum = Number(wStr);
  const jan4 = new Date(Date.UTC(year, 0, 4));
  const jan4Day = jan4.getUTCDay() || 7;
  const week1Monday = new Date(jan4);
  week1Monday.setUTCDate(jan4.getUTCDate() - (jan4Day - 1));
  const target = new Date(week1Monday);
  target.setUTCDate(week1Monday.getUTCDate() + (weekNum - 1) * 7);
  return target;
}

// Confirmado 2026-08-14: días laborables Provedix son lunes a sábado (mismo
// criterio que isValidOvertimeDate en payrollCalc.ts — domingo nunca cuenta)
// más los feriados fijos ya modelados en recognition.ts. Ojo: NO es lo mismo
// que isBusinessDay() de recognition.ts, que ahí trata sábado como fin de
// semana — ese es específico de los plazos de Colaborador Destacado, no de
// la semana laboral real de la empresa.
function isProvedixBusinessDay(date: Date): boolean {
  return date.getUTCDay() !== 0 && !isFixedHoliday(date);
}

function businessDaysInRange(start: Date, end: Date): number {
  let count = 0;
  const d = new Date(start);
  while (d < end) {
    if (isProvedixBusinessDay(d)) count++;
    d.setUTCDate(d.getUTCDate() + 1);
  }
  return count;
}

// Confirmado 2026-08-14: pedido explícito del usuario — el rango de
// pedidos por nivel (750-1050) es el PROMEDIO DIARIO de "Pedidos
// despachados" (WeeklyMetricRecord del depto con trackWeeklyMetric,
// hoy Fulfillment), promediado sobre un mes calendario — nunca el total
// semanal ni el agregado mensual grande que ya se ve en Inicio.
//
// Una semana ISO "pertenece" al mes cuyo calendario contiene su lunes —
// mismo criterio simple ya usado en otras partes de la app para atribuir
// una semana a un mes.
//
// `asOfNow`: para el mes EN CURSO (el widget de Inicio), los días
// laborables se cuentan solo hasta el domingo de la ÚLTIMA semana ya
// cargada — nunca hasta "hoy" del calendario. Bug real corregido
// 2026-08-14: dividir contra los días hábiles transcurridos hasta hoy
// hundía el promedio a inicios de la semana en curso, porque esos días
// todavía no tienen "Pedidos despachados" cargado (se reporta al cierre
// de la semana) — se contaban como si hubieran tenido cero pedidos.
export async function getDailyAverageForMonth(month: string, opts?: { asOfNow?: boolean }): Promise<number | null> {
  const dept = await prisma.department.findFirst({ where: { trackWeeklyMetric: true } });
  if (!dept) return null;

  const [y, m] = month.split("-").map(Number);
  const monthStart = new Date(Date.UTC(y, m - 1, 1));
  const monthEnd = new Date(Date.UTC(y, m, 1));

  const records = await prisma.weeklyMetricRecord.findMany({ where: { deptId: dept.id } });
  const monthRecords = records
    .map((r) => ({ ...r, monday: mondayOfIsoWeek(r.week) }))
    .filter((r) => r.monday >= monthStart && r.monday < monthEnd);
  if (monthRecords.length === 0) return null;

  const total = monthRecords.reduce((s, r) => s + r.value, 0);

  let rangeEnd = monthEnd;
  if (opts?.asOfNow) {
    const latestMonday = monthRecords.reduce((max, r) => (r.monday > max ? r.monday : max), monthRecords[0].monday);
    rangeEnd = new Date(Date.UTC(latestMonday.getUTCFullYear(), latestMonday.getUTCMonth(), latestMonday.getUTCDate() + 7));
  }
  const effectiveEnd = rangeEnd < monthEnd ? rangeEnd : monthEnd;
  const businessDays = businessDaysInRange(monthStart, effectiveEnd);
  if (businessDays === 0) return null;

  return total / businessDays;
}

export type CommissionTierRow = {
  id: string;
  name: string;
  orderIndex: number;
  minDailyAvg: number;
  maxDailyAvg: number | null;
};

// El nivel de mayor orderIndex cuyo mínimo ya se alcanzó — superar el techo
// del nivel más alto sigue contando como ese nivel (maxDailyAvg es solo
// informativo), no lo excluye. null si no se alcanzó ni el primer nivel.
export async function getAchievedTier(dailyAvg: number): Promise<CommissionTierRow | null> {
  const tiers = await prisma.commissionTier.findMany({ where: { isActive: true }, orderBy: { orderIndex: "asc" } });
  let achieved: CommissionTierRow | null = null;
  for (const t of tiers) {
    if (dailyAvg >= t.minDailyAvg) achieved = t;
  }
  return achieved;
}

export const CEO_BONUS_AMOUNTS: Record<"ADICIONAL" | "PRODUCTIVIDAD" | "MERITO", number> = {
  ADICIONAL: 50,
  PRODUCTIVIDAD: 100,
  MERITO: 150,
};

export const CEO_BONUS_LABELS: Record<"ADICIONAL" | "PRODUCTIVIDAD" | "MERITO", string> = {
  ADICIONAL: "Bono Adicional",
  PRODUCTIVIDAD: "Bono de Productividad",
  MERITO: "Bono al Mérito",
};
