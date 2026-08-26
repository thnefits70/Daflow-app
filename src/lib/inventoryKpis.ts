import { prisma } from "@/lib/prisma";
import { computeDerived, consolidateMonth, workingCapitalDays, type FinanceMonthRaw } from "@/lib/financeKpisCalc";
import { lastOfficeDayAtOrBefore } from "@/lib/businessHours";
import {
  gmroi,
  detectOverstockAlert,
  trendIsGood,
  computeStaleStreaks,
  summarizeStaleStreaks,
  type StaleStreakEntry,
} from "@/lib/inventoryKpisCalc";

// Igual offset que businessHours.ts/pendingTasks.ts — Ecuador es UTC-5 fijo,
// sin horario de verano. Cada archivo mantiene su propia copia (mismo
// criterio ya usado en el resto del proyecto) en vez de exportarla, para no
// acoplar módulos que no la necesitan.
const ECUADOR_OFFSET_MS = 5 * 60 * 60 * 1000;

function pad2(n: number): string {
  return String(n).padStart(2, "0");
}

// Company-wide, no importa la marca (Provedix e Importadora Damián comparten
// bodega) — todo lo de inventario vive bajo el departamento Finanzas, igual
// que FinanceSharedMonthlyBalance.
export async function getFinanzasDeptId(): Promise<string | null> {
  const dept = await prisma.department.findUnique({ where: { code: "FIN" }, select: { id: true } });
  return dept?.id ?? null;
}

export function currentPeriod(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
}

// Confirmado 2026-08-05: Daniel debe poder cargar o corregir cualquier mes
// reciente (ej. julio, no solo el mes en curso), no solo el actual — últimos
// 12 meses hasta el actual, igual criterio que periodOptions() de
// FinanceUploadPanel.tsx (sin meses futuros, acá no aplica adelantarse).
export function recentInventoryPeriods(): string[] {
  const now = new Date();
  const periods: string[] = [];
  for (let i = -11; i <= 0; i++) {
    const d = new Date(now.getFullYear(), now.getMonth() + i, 1);
    periods.push(`${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`);
  }
  return periods;
}

const MONTH_NAMES_FULL = [
  "Enero", "Febrero", "Marzo", "Abril", "Mayo", "Junio",
  "Julio", "Agosto", "Septiembre", "Octubre", "Noviembre", "Diciembre",
];

// Confirmado 2026-08-25: pedido explícito de Daniel — el Excel de stock por
// SKU ("Productos sin movimiento") pasa de mensual a semanal para poder
// reaccionar más rápido, pero SIGUE etiquetado por mes ("Agosto 2026
// (semana 2)") para mantener el historial legible en el tiempo. Semanas
// fijas dentro del mes (no calendario real): semana 1 = días 1-7, semana 2
// = 8-14, semana 3 = 15-21, semana 4 = 22 hasta fin de mes — reinician cada
// mes, así que un mes siempre tiene exactamente 4 "semanas" en el sistema
// aunque tenga 28 a 31 días reales. El "Valor de inventario del mes" (monto
// total con captura) NO cambió — sigue mensual.
export type SnapshotPeriod = { year: number; month: number; week: 1 | 2 | 3 | 4 };

export function formatSnapshotPeriod(p: SnapshotPeriod): string {
  return `${p.year}-${pad2(p.month)}-W${p.week}`;
}

export function parseSnapshotPeriod(period: string): SnapshotPeriod {
  const [y, m, w] = period.split("-");
  return { year: Number(y), month: Number(m), week: Number(w.slice(1)) as 1 | 2 | 3 | 4 };
}

function snapshotPeriodOfEcuadorDate(ecuadorShifted: Date): SnapshotPeriod {
  const day = ecuadorShifted.getUTCDate();
  const week = day <= 7 ? 1 : day <= 14 ? 2 : day <= 21 ? 3 : 4;
  return { year: ecuadorShifted.getUTCFullYear(), month: ecuadorShifted.getUTCMonth() + 1, week };
}

function prevSnapshotPeriod(p: SnapshotPeriod): SnapshotPeriod {
  if (p.week > 1) return { ...p, week: (p.week - 1) as 1 | 2 | 3 | 4 };
  const d = new Date(Date.UTC(p.year, p.month - 2, 1)); // mes anterior
  return { year: d.getUTCFullYear(), month: d.getUTCMonth() + 1, week: 4 };
}

export function currentSnapshotPeriod(): string {
  const ecuadorShifted = new Date(Date.now() - ECUADOR_OFFSET_MS);
  return formatSnapshotPeriod(snapshotPeriodOfEcuadorDate(ecuadorShifted));
}

// Últimas ~12 semanas (≈3 meses) hasta la actual, más que suficiente para
// que Daniel corrija una semana reciente sin volver la lista eterna (a
// diferencia de recentInventoryPeriods(), que sí mira 12 meses completos
// porque el valor mensual se corrige con menos frecuencia).
export function recentInventorySnapshotPeriods(): string[] {
  let cur = parseSnapshotPeriod(currentSnapshotPeriod());
  const out: string[] = [formatSnapshotPeriod(cur)];
  for (let i = 0; i < 11; i++) {
    cur = prevSnapshotPeriod(cur);
    out.push(formatSnapshotPeriod(cur));
  }
  return out.reverse(); // más antigua primero, igual orden que recentInventoryPeriods()
}

export function snapshotPeriodLabel(period: string): string {
  const p = parseSnapshotPeriod(period);
  return `${MONTH_NAMES_FULL[p.month - 1] ?? p.month} ${p.year} (semana ${p.week})`;
}

// Último día calendario del bloque de esa semana dentro del mes (7/14/21/
// fin de mes) — el límite "natural" antes de rodar hacia atrás por domingo
// u feriado.
function snapshotPeriodBoundaryDay(p: SnapshotPeriod): number {
  if (p.week < 4) return p.week * 7;
  return new Date(Date.UTC(p.year, p.month, 0)).getUTCDate();
}

// Fecha límite para cargar el Excel de esa semana — pedido explícito de
// Daniel (2026-08-25): el último día laborable del bloque, retrocediendo
// sobre domingos/feriados igual que el resto del sistema (ver
// lastOfficeDayAtOrBefore en businessHours.ts). Hora de corte: antes de las
// 12:00 si ese día laborable cae sábado (la oficina solo abre medio día),
// antes de las 16:00 cualquier otro día (viernes, o el que sea si sábado
// también es feriado).
export function snapshotPeriodDeadline(period: string): Date {
  const p = parseSnapshotPeriod(period);
  const boundaryDay = snapshotPeriodBoundaryDay(p);
  // Medianoche real (instante UTC) de ese día calendario en Ecuador —
  // 00:00 hora Ecuador = 05:00 UTC.
  const boundaryReal = new Date(Date.UTC(p.year, p.month - 1, boundaryDay, ECUADOR_OFFSET_MS / 3600000, 0, 0));
  const lastBizDayReal = lastOfficeDayAtOrBefore(boundaryReal);
  const ecuadorShifted = new Date(lastBizDayReal.getTime() - ECUADOR_OFFSET_MS);
  const isSaturday = ecuadorShifted.getUTCDay() === 6;
  const deadlineEcuadorShifted = new Date(ecuadorShifted);
  deadlineEcuadorShifted.setUTCHours(isSaturday ? 12 : 16, 0, 0, 0);
  return new Date(deadlineEcuadorShifted.getTime() + ECUADOR_OFFSET_MS);
}

export function isSnapshotPeriodOverdue(period: string): boolean {
  return new Date() >= snapshotPeriodDeadline(period);
}

const DEADLINE_FMT_DATE = new Intl.DateTimeFormat("es-EC", { timeZone: "America/Guayaquil", weekday: "short", day: "numeric", month: "short" });
const DEADLINE_FMT_HOUR = new Intl.DateTimeFormat("es-EC", { timeZone: "America/Guayaquil", hour: "numeric", minute: "2-digit", hour12: true });

export function snapshotPeriodDeadlineLabel(period: string): string {
  const d = snapshotPeriodDeadline(period);
  return `${DEADLINE_FMT_DATE.format(d)}, antes de las ${DEADLINE_FMT_HOUR.format(d)}`;
}

export type InventoryControlPeriodDTO = {
  period: string;
  value: number | null;
  proofUrl: string | null;
  aiMatches: boolean | null;
  hasSnapshot: boolean;
};

export type InventorySnapshotPeriodDTO = {
  period: string;
  label: string;
  hasSnapshot: boolean;
  deadlineLabel: string;
  overdue: boolean;
};

// Todo lo que necesita la pantalla de Daniel ("Control de Inventario" en Mi
// área de trabajo) — solo captura, nunca ve gráficas ni el ranking desde acá
// (write-only, confirmado 2026-08-04). Trae los últimos 12 meses (con lo ya
// cargado, si hay) para que pueda elegir cualquiera, no solo el mes en curso.
export async function getInventoryControlData() {
  const deptId = await getFinanzasDeptId();
  if (!deptId) return null;

  const periods = recentInventoryPeriods();
  const weeklyPeriods = recentInventorySnapshotPeriods();
  const [balances, snapshotPeriodRows, weeklySnapshotRows] = await Promise.all([
    prisma.financeSharedMonthlyBalance.findMany({ where: { deptId, period: { in: periods } } }),
    prisma.inventoryProductSnapshot.findMany({ where: { deptId, period: { in: periods } }, select: { period: true }, distinct: ["period"] }),
    prisma.inventoryProductSnapshot.findMany({ where: { deptId, period: { in: weeklyPeriods } }, select: { period: true }, distinct: ["period"] }),
  ]);
  const byPeriod = new Map(balances.map((b) => [b.period, b]));
  const snapshotSet = new Set(snapshotPeriodRows.map((s) => s.period));
  const weeklySnapshotSet = new Set(weeklySnapshotRows.map((s) => s.period));

  return {
    deptId,
    currentPeriod: currentPeriod(),
    periods: periods.map((period): InventoryControlPeriodDTO => {
      const b = byPeriod.get(period);
      return {
        period,
        value: b?.inventarioFinal ?? null,
        proofUrl: b?.inventarioProofUrl ?? null,
        aiMatches: b?.inventarioAiMatches ?? null,
        hasSnapshot: snapshotSet.has(period),
      };
    }),
    currentSnapshotPeriod: currentSnapshotPeriod(),
    snapshotPeriods: weeklyPeriods.map((period): InventorySnapshotPeriodDTO => {
      const hasSnapshot = weeklySnapshotSet.has(period);
      return {
        period,
        label: snapshotPeriodLabel(period),
        hasSnapshot,
        deadlineLabel: snapshotPeriodDeadlineLabel(period),
        overdue: !hasSnapshot && isSnapshotPeriodOverdue(period),
      };
    }),
  };
}

export type InventoryMonthPoint = {
  period: string;
  inventario: number | null;
  ventas: number;
  costoVentas: number;
  utilidadBruta: number;
};

export type InventoryKpisDataDTO = {
  hasData: boolean;
  series: InventoryMonthPoint[];
  dioSeries: (number | null)[];
  gmroiFullSeries: (number | null)[];
  dio: { current: number | null; previous: number | null; good: boolean | null };
  gmroiSeries: { current: number | null; previous: number | null; good: boolean | null };
  overstockAlert: { alert: boolean; message: string | null };
  staleSummary: ReturnType<typeof summarizeStaleStreaks>;
  staleEntries: StaleStreakEntry[];
  staleSnapshotPeriod: string | null;
  // Confirmado 2026-08-05: vista interina mientras se acumula un segundo mes
  // de historial — todos los productos del mes más reciente cargado, para
  // que se puedan revisar por stock/valor aunque el sistema todavía no tenga
  // base de comparación para marcar "sin movimiento" de verdad.
  latestSnapshotRows: { productCode: string; description: string; avgCost: number; stock: number; costTotal: number }[];
};

// Todo lo que necesita la pestaña "Inventario" dentro de KPIs financieros —
// visible a quien ya ve KPIs financieros (Nairoby como líder de Finanzas, y
// admin), sin permiso adicional.
export async function getInventoryKpisData(): Promise<InventoryKpisDataDTO> {
  const empty: InventoryKpisDataDTO = {
    hasData: false,
    series: [],
    dioSeries: [],
    gmroiFullSeries: [],
    dio: { current: null, previous: null, good: null },
    gmroiSeries: { current: null, previous: null, good: null },
    overstockAlert: { alert: false, message: null },
    staleSummary: summarizeStaleStreaks([], null),
    staleEntries: [],
    staleSnapshotPeriod: null,
    latestSnapshotRows: [],
  };

  const deptId = await getFinanzasDeptId();
  if (!deptId) return empty;

  const [records, balances, snapshots] = await Promise.all([
    prisma.financeKpiRecord.findMany({ where: { deptId }, orderBy: { period: "asc" } }),
    prisma.financeSharedMonthlyBalance.findMany({ where: { deptId }, orderBy: { period: "asc" } }),
    prisma.inventoryProductSnapshot.findMany({ where: { deptId }, orderBy: { period: "asc" } }),
  ]);

  const staleEntries = computeStaleStreaks(snapshots);
  const staleSnapshotPeriod = snapshots.length > 0 ? snapshots[snapshots.length - 1].period : null;
  const latestSnapshotTotal = staleSnapshotPeriod
    ? snapshots.filter((s) => s.period === staleSnapshotPeriod).reduce((sum, s) => sum + s.costTotal, 0)
    : null;
  const staleSummary = summarizeStaleStreaks(staleEntries, latestSnapshotTotal);
  const latestSnapshotRows = staleSnapshotPeriod
    ? snapshots
        .filter((s) => s.period === staleSnapshotPeriod)
        .map((s) => ({ productCode: s.productCode, description: s.description, avgCost: s.avgCost, stock: s.stock, costTotal: s.costTotal }))
    : [];

  if (records.length === 0) return { ...empty, staleEntries, staleSnapshotPeriod, staleSummary, latestSnapshotRows };

  const byPeriod = new Map<string, FinanceMonthRaw[]>();
  for (const r of records) {
    const arr = byPeriod.get(r.period) ?? [];
    arr.push({
      period: r.period, ventas: r.ventas, costoVentas: r.costoVentas, gastosVenta: r.gastosVenta,
      gastosAdmin: r.gastosAdmin, otrosIngresos: r.otrosIngresos, gastosFinancieros: r.gastosFinancieros,
      otrosGastos: r.otrosGastos,
    });
    byPeriod.set(r.period, arr);
  }
  const balanceByPeriod = new Map(balances.map((b) => [b.period, b.inventarioFinal]));

  const periods = Array.from(byPeriod.keys()).sort().slice(-12);
  const series: InventoryMonthPoint[] = periods.map((period) => {
    const consolidated = computeDerived(consolidateMonth(byPeriod.get(period)!));
    return {
      period,
      inventario: balanceByPeriod.get(period) ?? null,
      ventas: consolidated.ventas,
      costoVentas: consolidated.costoVentas,
      utilidadBruta: consolidated.utilidadBruta,
    };
  });

  const dioSeries: (number | null)[] = series.map((pt, i) => {
    if (pt.inventario === null) return null;
    const prevInv = i > 0 ? series[i - 1].inventario : null;
    return workingCapitalDays(pt.inventario, prevInv, pt.costoVentas);
  });
  const gmroiFullSeries: (number | null)[] = series.map((pt, i) => {
    if (pt.inventario === null) return null;
    const prevInv = i > 0 ? series[i - 1].inventario : null;
    return gmroi(pt.utilidadBruta, pt.inventario, prevInv);
  });
  const dioCurrent = dioSeries[dioSeries.length - 1] ?? null;
  const dioPrevious = dioSeries.length >= 2 ? dioSeries[dioSeries.length - 2] : null;
  const gmroiCurrent = gmroiFullSeries[gmroiFullSeries.length - 1] ?? null;
  const gmroiPrevious = gmroiFullSeries.length >= 2 ? gmroiFullSeries[gmroiFullSeries.length - 2] : null;

  const overstockSeries = series
    .filter((p) => p.inventario !== null)
    .map((p) => ({ period: p.period, inventario: p.inventario as number, ventas: p.ventas }));

  return {
    hasData: true,
    series,
    dioSeries,
    gmroiFullSeries,
    dio: { current: dioCurrent, previous: dioPrevious, good: dioCurrent !== null ? trendIsGood(dioCurrent, dioPrevious, "down") : null },
    gmroiSeries: { current: gmroiCurrent, previous: gmroiPrevious, good: gmroiCurrent !== null ? trendIsGood(gmroiCurrent, gmroiPrevious, "up") : null },
    overstockAlert: detectOverstockAlert(overstockSeries),
    staleSummary,
    staleEntries,
    staleSnapshotPeriod,
    latestSnapshotRows,
  };
}
