import { prisma } from "@/lib/prisma";
import { computeDerived, consolidateMonth, workingCapitalDays, type FinanceMonthRaw } from "@/lib/financeKpisCalc";
import { getNegativeStockProducts, getExpiringLots, getInvestockValueByMonthEnd, type ExpiringLot } from "@/lib/stockKardex";
import {
  gmroi,
  detectOverstockAlert,
  trendIsGood,
  computeStaleStreaks,
  summarizeStaleStreaks,
  type StaleStreakEntry,
  type ProductSnapshotRow,
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

// Confirmado 2026-08-25: pedido explícito de Daniel — el stock por SKU
// ("Productos sin movimiento") pasa de mensual a semanal para poder
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

// Último día calendario del bloque de esa semana dentro del mes (7/14/21/
// fin de mes).
function snapshotPeriodBoundaryDay(p: SnapshotPeriod): number {
  if (p.week < 4) return p.week * 7;
  return new Date(Date.UTC(p.year, p.month, 0)).getUTCDate();
}

// Confirmado 2026-09-23, pedido explícito del usuario ("ya solo trabajamos
// con INVESTOCK", "todo automático"): Daniel ya no sube el Excel semanal de
// Just. Las semanas de antes de esta fecha conservan lo que él subió (es la
// única historia que existe de esas semanas); desde AUTO_SNAPSHOT_START en
// adelante, el stock de cada producto al cierre de cada semana se
// reconstruye solo desde el Kardex, con el mismo formato — así el ranking
// de "productos sin movimiento" sigue funcionando igual, sin que nadie
// suba nada. productCode usa el código del producto cuando lo tiene (el
// mismo que traía el Excel), para que la racha de un producto no se corte
// al pasar de una fuente a la otra.
const AUTO_SNAPSHOT_START = "2026-09-W4";

function snapshotPeriodEnd(period: string): Date {
  const p = parseSnapshotPeriod(period);
  // Último instante (hora Ecuador) del último día del bloque de esa semana.
  return new Date(Date.UTC(p.year, p.month - 1, snapshotPeriodBoundaryDay(p), 23, 59, 59, 999) + ECUADOR_OFFSET_MS);
}

function nextSnapshotPeriod(p: SnapshotPeriod): SnapshotPeriod {
  if (p.week < 4) return { ...p, week: (p.week + 1) as 1 | 2 | 3 | 4 };
  return p.month === 12 ? { year: p.year + 1, month: 1, week: 1 } : { year: p.year, month: p.month + 1, week: 1 };
}

async function getKardexWeeklySnapshotRows(): Promise<ProductSnapshotRow[]> {
  const now = new Date();
  const periods: string[] = [];
  // Solo semanas ya terminadas: una semana a medias haría parecer "sin
  // movimiento" a un producto que todavía puede venderse antes del cierre.
  for (let cur = parseSnapshotPeriod(AUTO_SNAPSHOT_START); snapshotPeriodEnd(formatSnapshotPeriod(cur)) < now; cur = nextSnapshotPeriod(cur)) {
    periods.push(formatSnapshotPeriod(cur));
  }
  if (periods.length === 0) return [];

  const [entries, items] = await Promise.all([
    prisma.stockKardexEntry.findMany({
      where: { occurredAt: { lte: snapshotPeriodEnd(periods[periods.length - 1]) } },
      orderBy: [{ occurredAt: "asc" }, { createdAt: "asc" }],
      select: { catalogItemId: true, occurredAt: true, balanceAfter: true, avgCostAfter: true },
    }),
    prisma.purchaseCatalogItem.findMany({ select: { id: true, name: true, justCode: true } }),
  ]);
  const itemById = new Map(items.map((i) => [i.id, i]));

  const rows: ProductSnapshotRow[] = [];
  const lastByItem = new Map<string, { balanceAfter: number; avgCostAfter: number }>();
  let idx = 0;
  for (const period of periods) {
    const end = snapshotPeriodEnd(period);
    while (idx < entries.length && entries[idx].occurredAt <= end) {
      lastByItem.set(entries[idx].catalogItemId, entries[idx]);
      idx++;
    }
    for (const [catalogItemId, v] of lastByItem) {
      if (v.balanceAfter <= 0) continue; // sin stock no puede estar "sin movimiento"
      const item = itemById.get(catalogItemId);
      rows.push({
        period,
        productCode: item?.justCode ?? catalogItemId,
        description: item?.name ?? "Producto",
        avgCost: v.avgCostAfter,
        stock: v.balanceAfter,
        costTotal: v.balanceAfter * v.avgCostAfter,
      });
    }
  }
  return rows;
}

async function getStockSnapshotRows(deptId: string): Promise<ProductSnapshotRow[]> {
  const [legacy, auto] = await Promise.all([
    prisma.inventoryProductSnapshot.findMany({ where: { deptId, period: { lt: AUTO_SNAPSHOT_START } }, orderBy: { period: "asc" } }),
    getKardexWeeklySnapshotRows(),
  ]);
  return [
    ...legacy.map((s) => ({ period: s.period, productCode: s.productCode, description: s.description, avgCost: s.avgCost, stock: s.stock, costTotal: s.costTotal })),
    ...auto,
  ].sort((a, b) => a.period.localeCompare(b.period));
}

export type InventoryControlPeriodDTO = {
  period: string;
  value: number | null;
  // Confirmado 2026-09-17, pedido explícito del usuario: este valor ya no
  // lo escribe Daniel a mano — se calcula solo desde INVESTOCK (Kardex
  // real: balance × costo promedio de cada producto, reconstruido al
  // cierre de ese mes). "manual" solo aparece en meses de antes de
  // que existiera INVESTOCK — se conservan tal cual, sin recalcular.
  source: "auto" | "manual" | null;
  proofUrl: string | null;
  aiMatches: boolean | null;
  hasSnapshot: boolean;
};

// Todo lo que necesita la pantalla de Daniel ("Control de Inventario" en Mi
// área de trabajo) — solo captura, nunca ve gráficas ni el ranking desde acá
// (write-only, confirmado 2026-08-04). Trae los últimos 12 meses (con lo ya
// cargado, si hay) para que pueda elegir cualquiera, no solo el mes en curso.
export async function getInventoryControlData() {
  const deptId = await getFinanzasDeptId();
  if (!deptId) return null;

  const periods = recentInventoryPeriods();
  const [balances, autoByMonth] = await Promise.all([
    prisma.financeSharedMonthlyBalance.findMany({ where: { deptId, period: { in: periods } } }),
    getInvestockValueByMonthEnd(periods),
  ]);
  const byPeriod = new Map(balances.map((b) => [b.period, b]));

  return {
    deptId,
    currentPeriod: currentPeriod(),
    periods: periods.map((period): InventoryControlPeriodDTO => {
      const b = byPeriod.get(period);
      const auto = autoByMonth.get(period);
      return {
        period,
        value: auto !== undefined ? auto : b?.inventarioFinal ?? null,
        source: auto !== undefined ? "auto" : b?.inventarioFinal != null ? "manual" : null,
        proofUrl: b?.inventarioProofUrl ?? null,
        aiMatches: b?.inventarioAiMatches ?? null,
        hasSnapshot: auto !== undefined,
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
  // Fase 3 (INVESTOCK) — confirmado 2026-09-09: productos con saldo
  // negativo en el Kardex propio (error de conteo, o algo que salió sin
  // que entrara registrado) — se calcula del Kardex, no del export de Just.
  negativeStockProducts: { catalogItemId: string; name: string; balance: number }[];
  // Confirmado 2026-09-10, pedido de Daniel: lotes con caducidad dentro de
  // 6 meses — red de seguridad en pantalla además del aviso por push.
  expiringLots: ExpiringLot[];
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
    negativeStockProducts: [],
    expiringLots: [],
    staleSummary: summarizeStaleStreaks([], null),
    staleEntries: [],
    staleSnapshotPeriod: null,
    latestSnapshotRows: [],
  };

  const deptId = await getFinanzasDeptId();
  if (!deptId) return empty;

  const [records, balances, snapshots, negativeStockProducts, expiringLots] = await Promise.all([
    prisma.financeKpiRecord.findMany({ where: { deptId }, orderBy: { period: "asc" } }),
    prisma.financeSharedMonthlyBalance.findMany({ where: { deptId }, orderBy: { period: "asc" } }),
    getStockSnapshotRows(deptId),
    getNegativeStockProducts(),
    getExpiringLots(),
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

  if (records.length === 0) return { ...empty, staleEntries, staleSnapshotPeriod, staleSummary, latestSnapshotRows, negativeStockProducts, expiringLots };

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
  const autoByMonth = await getInvestockValueByMonthEnd(periods);
  const series: InventoryMonthPoint[] = periods.map((period) => {
    const consolidated = computeDerived(consolidateMonth(byPeriod.get(period)!));
    return {
      period,
      inventario: autoByMonth.get(period) ?? balanceByPeriod.get(period) ?? null,
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
    negativeStockProducts,
    expiringLots,
    staleSummary,
    staleEntries,
    staleSnapshotPeriod,
    latestSnapshotRows,
  };
}
