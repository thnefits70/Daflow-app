import { prisma } from "@/lib/prisma";
import { computeDerived, consolidateMonth, workingCapitalDays, type FinanceMonthRaw } from "@/lib/financeKpisCalc";
import {
  currentQuarter,
  isReviewDue,
  daysUntilDue,
  gmroi,
  summarizeStaleProducts,
  detectOverstockAlert,
  trendIsGood,
  type StaleProductRow,
} from "@/lib/inventoryKpisCalc";

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

export type StaleProductDTO = {
  id: string;
  name: string;
  value: number;
  status: string;
  quartersConfirmed: number;
  lastConfirmedQuarter: string;
};

export type InventoryControlPeriodDTO = {
  period: string;
  value: number | null;
  proofUrl: string | null;
  aiMatches: boolean | null;
};

// Todo lo que necesita la pantalla de Daniel ("Control de Inventario" en Mi
// área de trabajo) — solo captura, nunca ve gráficas desde acá. Trae los
// últimos 12 meses (con lo ya cargado, si hay) para que pueda elegir
// cualquiera, no solo el mes en curso.
export async function getInventoryControlData() {
  const deptId = await getFinanzasDeptId();
  if (!deptId) return null;

  const periods = recentInventoryPeriods();
  const [balances, products] = await Promise.all([
    prisma.financeSharedMonthlyBalance.findMany({ where: { deptId, period: { in: periods } } }),
    prisma.inventoryStaleProduct.findMany({ where: { deptId }, orderBy: { createdAt: "asc" } }),
  ]);
  const byPeriod = new Map(balances.map((b) => [b.period, b]));

  return {
    deptId,
    currentPeriod: currentPeriod(),
    periods: periods.map((period): InventoryControlPeriodDTO => {
      const b = byPeriod.get(period);
      return { period, value: b?.inventarioFinal ?? null, proofUrl: b?.inventarioProofUrl ?? null, aiMatches: b?.inventarioAiMatches ?? null };
    }),
    products: products.map((p): StaleProductDTO => ({
      id: p.id,
      name: p.name,
      value: p.value,
      status: p.status,
      quartersConfirmed: p.quartersConfirmed,
      lastConfirmedQuarter: p.lastConfirmedQuarter,
    })),
    currentQuarter: currentQuarter(),
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
  staleSummary: ReturnType<typeof summarizeStaleProducts>;
  staleProducts: StaleProductDTO[];
  currentQuarter: string;
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
    staleSummary: summarizeStaleProducts([], null),
    staleProducts: [],
    currentQuarter: currentQuarter(),
  };

  const deptId = await getFinanzasDeptId();
  if (!deptId) return empty;

  const [records, balances, products] = await Promise.all([
    prisma.financeKpiRecord.findMany({ where: { deptId }, orderBy: { period: "asc" } }),
    prisma.financeSharedMonthlyBalance.findMany({ where: { deptId }, orderBy: { period: "asc" } }),
    prisma.inventoryStaleProduct.findMany({ where: { deptId }, orderBy: { createdAt: "asc" } }),
  ]);

  if (records.length === 0) return { ...empty, staleProducts: products.map(toStaleDTO) };

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
    staleSummary: summarizeStaleProducts(products.map(toStaleRow), series[series.length - 1]?.inventario ?? null),
    staleProducts: products.map(toStaleDTO),
    currentQuarter: currentQuarter(),
  };
}

function toStaleDTO(p: { id: string; name: string; value: number; status: string; quartersConfirmed: number; lastConfirmedQuarter: string }): StaleProductDTO {
  return { id: p.id, name: p.name, value: p.value, status: p.status, quartersConfirmed: p.quartersConfirmed, lastConfirmedQuarter: p.lastConfirmedQuarter };
}
function toStaleRow(p: { id: string; name: string; value: number; status: string; quartersConfirmed: number }): StaleProductRow {
  return { id: p.id, name: p.name, value: p.value, status: p.status, quartersConfirmed: p.quartersConfirmed };
}

export { isReviewDue, daysUntilDue };
