// Comisiones de equipo por niveles — diseñado en conversación larga con el
// usuario 2026-08-14, no re-derivar. Mismo espíritu que payrollCalc.ts:
// nunca se guarda un resultado derivado, siempre se recalcula desde los
// datos crudos (WeeklyMetricRecord).
import { prisma } from "@/lib/prisma";

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

// Confirmado 2026-08-14: días laborables Provedix son lunes a sábado —
// SOLO se excluye domingo (mismo criterio que isValidOvertimeDate en
// payrollCalc.ts), los feriados NO se excluyen para este cálculo
// específico (confirmado explícitamente por el usuario). Ojo: NO es lo
// mismo que isBusinessDay() de recognition.ts, que ahí trata sábado como
// fin de semana — ese es específico de los plazos de Colaborador
// Destacado, no de la semana laboral real de la empresa.
function isProvedixBusinessDay(date: Date): boolean {
  return date.getUTCDay() !== 0;
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

export type MonthDispatchSummary = {
  dailyAvg: number;
  totalPedidos: number;
  businessDays: number;
  weeks: number;
  from: string; // "YYYY-MM-DD" — lunes de la primera semana con dato
  to: string; // "YYYY-MM-DD" — sábado de la última semana con dato
};

// Confirmado 2026-08-14: pedido explícito del usuario — el rango de
// pedidos por nivel (750-1050) es el total de "Pedidos despachados" del
// mes (WeeklyMetricRecord del depto con trackWeeklyMetric, hoy
// Fulfillment), dividido entre los días de lunes a sábado — domingos NO
// cuentan, feriados SÍ cuentan como día laborable (confirmado
// explícitamente: acá no se excluyen, a diferencia de otros cálculos de
// la app). Nunca el total semanal ni el agregado mensual grande que ya se
// ve en Inicio.
//
// Una semana ISO "pertenece" al mes cuyo calendario contiene su lunes —
// mismo criterio simple ya usado en otras partes de la app para atribuir
// una semana a un mes.
//
// Bug real corregido 2026-08-14 (dos vueltas): el denominador de días
// laborables se calculaba como un rango continuo desde el 1 del mes, lo
// que colaba días de la semana ANTERIOR (atribuida a otro mes) dentro del
// conteo — ej. el sábado 1 de agosto pertenece a la semana que se atribuyó
// a julio, pero igual se contaba como día hábil de agosto. Ahora los días
// laborables se suman SOLO dentro de cada semana ya atribuida (su propio
// lunes a domingo), nunca de un rango de calendario aparte — así el mes en
// curso (con una sola semana cargada) da exactamente lo mismo que el
// promedio de esa semana sola, sin desfase.
export async function getMonthDispatchSummary(month: string): Promise<MonthDispatchSummary | null> {
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
  const businessDays = monthRecords.reduce((s, r) => {
    const weekEnd = new Date(Date.UTC(r.monday.getUTCFullYear(), r.monday.getUTCMonth(), r.monday.getUTCDate() + 7));
    return s + businessDaysInRange(r.monday, weekEnd);
  }, 0);
  if (businessDays === 0) return null;

  const mondays = monthRecords.map((r) => r.monday);
  const minMonday = mondays.reduce((a, b) => (b < a ? b : a));
  const maxMonday = mondays.reduce((a, b) => (b > a ? b : a));
  const lastSaturday = new Date(Date.UTC(maxMonday.getUTCFullYear(), maxMonday.getUTCMonth(), maxMonday.getUTCDate() + 5));

  return {
    dailyAvg: total / businessDays,
    totalPedidos: total,
    businessDays,
    weeks: monthRecords.length,
    from: minMonday.toISOString().slice(0, 10),
    to: lastSaturday.toISOString().slice(0, 10),
  };
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
