// Pure calculation helpers for the "KPIs financieros" dashboard — no Prisma,
// no server-only imports, so this file can be imported from both the
// server-side data assembly (financeKpis.ts) and client components that
// need to recompute margins/deltas/status instantly on every filter change,
// the same way the approved boceto did entirely in the browser.

export type FinanceMonthRaw = {
  period: string; // "YYYY-MM"
  ventas: number;
  costoVentas: number;
  gastosVenta: number;
  gastosAdmin: number;
  otrosIngresos: number;
  gastosFinancieros: number;
  otrosGastos: number;
  roi: number | null;
};

export type FinanceMonthDerived = FinanceMonthRaw & {
  utilidadBruta: number;
  margenBruto: number;
  gastosOperativos: number;
  utilidadOperativa: number;
  margenOperativo: number;
  utilidadReportada: number;
  margenNeto: number;
};

export function computeDerived(row: FinanceMonthRaw): FinanceMonthDerived {
  const utilidadBruta = row.ventas - row.costoVentas;
  const margenBruto = row.ventas === 0 ? 0 : (utilidadBruta / row.ventas) * 100;
  const gastosOperativos = row.gastosVenta + row.gastosAdmin;
  const utilidadOperativa = utilidadBruta - gastosOperativos;
  const margenOperativo = row.ventas === 0 ? 0 : (utilidadOperativa / row.ventas) * 100;
  const utilidadReportada = utilidadOperativa + row.otrosIngresos - row.gastosFinancieros - row.otrosGastos;
  const margenNeto = row.ventas === 0 ? 0 : (utilidadReportada / row.ventas) * 100;
  return { ...row, utilidadBruta, margenBruto, gastosOperativos, utilidadOperativa, margenOperativo, utilidadReportada, margenNeto };
}

// Sums raw fields across every operación present for a period — the real
// "Consolidado" value, unlike the boceto's estimate (it had no real
// per-operación data yet, only a company-wide total to scale down from).
export function consolidateMonth(rows: FinanceMonthRaw[]): FinanceMonthRaw {
  const period = rows[0]?.period ?? "";
  const sum = (k: keyof Omit<FinanceMonthRaw, "period" | "roi">) => rows.reduce((a, r) => a + r[k], 0);
  const ventas = sum("ventas");
  const roiRows = rows.filter((r) => r.roi !== null && r.ventas > 0);
  const roi = roiRows.length
    ? roiRows.reduce((a, r) => a + r.roi! * r.ventas, 0) / roiRows.reduce((a, r) => a + r.ventas, 0)
    : null;
  return {
    period,
    ventas,
    costoVentas: sum("costoVentas"),
    gastosVenta: sum("gastosVenta"),
    gastosAdmin: sum("gastosAdmin"),
    otrosIngresos: sum("otrosIngresos"),
    gastosFinancieros: sum("gastosFinancieros"),
    otrosGastos: sum("otrosGastos"),
    roi,
  };
}

// Chronological framing: the earlier month is always the reference
// ("resultado pasado"), the later one is what it grew/shrank to
// ("resultado futuro") — positive always means the later period is bigger,
// no matter which one the user picked as "Analizar" vs "Comparar contra".
export function chronoDelta(
  earlierRaw: Record<string, number | string | null>,
  labelEarlier: string,
  laterRaw: Record<string, number | string | null>,
  labelLater: string,
  key: string,
  isPercent: boolean
) {
  const earlierFirst = labelEarlier <= labelLater;
  const earlierVal = Number(earlierFirst ? earlierRaw[key] : laterRaw[key]);
  const laterVal = Number(earlierFirst ? laterRaw[key] : earlierRaw[key]);
  const moneyDiff = laterVal - earlierVal;
  const pctDiff = isPercent ? moneyDiff : (moneyDiff / Math.abs(earlierVal)) * 100;
  return { pctDiff, moneyDiff };
}

export type StatusBand = { cls: "good" | "warn" | "crit"; color: "good" | "warn" | "crit"; label: string };

// Margen bruto/operativo — relative to a single confirmed target (still
// placeholders for bruto/operativo until the user confirms real numbers).
export function statusForMargin(value: number, target: number): StatusBand {
  if (value >= target) return { cls: "good", color: "good", label: "sobre la meta" };
  if (value >= target * 0.8) return { cls: "warn", color: "warn", label: "cerca de la meta" };
  return { cls: "crit", color: "crit", label: "bajo la meta" };
}

// Margen neto — absolute bands confirmed for real: <alerta rojo,
// alerta-excelente verde saludable, >excelente teal "excelente".
export function marginNetoStatus(value: number, bands: { alerta: number; excelente: number }) {
  if (value >= bands.excelente) return { cls: "excelente" as const, label: "Excelente", icon: "🌟" };
  if (value >= bands.alerta) return { cls: "good" as const, label: "Saludable", icon: "🟢" };
  return { cls: "crit" as const, label: "Alerta", icon: "🔴" };
}

export function roiStatus(value: number, bands: { red: number; yellow: number }) {
  if (value >= bands.yellow) return { cls: "good" as const, label: "Saludable" };
  if (value >= bands.red) return { cls: "warn" as const, label: "Regular" };
  return { cls: "crit" as const, label: "Bajo / alerta" };
}

// Días de inventario/cartera/proveedores — only meaningful when the balance
// (company-wide, shared across operaciones) and the flow (ventas/costo de
// ventas) cover the same scope, i.e. Consolidado. avgBalance uses the
// previous period's balance when available, else just the current one.
export function workingCapitalDays(currentBalance: number, previousBalance: number | null, flow: number, daysInPeriod = 30) {
  const avgBalance = previousBalance !== null ? (currentBalance + previousBalance) / 2 : currentBalance;
  if (flow === 0) return null;
  return (avgBalance / flow) * daysInPeriod;
}

export function computeEbitda(derived: FinanceMonthDerived, daPctOfGAdmin: number) {
  const da = derived.gastosAdmin * daPctOfGAdmin;
  return { da, ebitda: derived.utilidadOperativa + da };
}

export function computeTaxProvision(derived: FinanceMonthDerived, taxRatePct: number) {
  const impuesto = Math.max(0, derived.utilidadReportada * (taxRatePct / 100));
  return { impuesto, utilidadDespuesImpuesto: derived.utilidadReportada - impuesto };
}

// Auto-generated financial analysis — two sections, "lo que va bien" and
// "por mejorar/atender", per the user's explicit ask to never blend praise
// and problems in one paragraph.
export function buildFinancialAnalysis(
  series: FinanceMonthDerived[],
  targetMargenNeto: number
): { good: string[]; improve: string[] } {
  if (series.length < 2) return { good: [], improve: [] };
  const first = series[0];
  const last = series[series.length - 1];
  const best = series.reduce((a, b) => (b.ventas > a.ventas ? b : a));
  const worst = series.reduce((a, b) => (b.margenNeto < a.margenNeto ? b : a));
  const avgMargenNeto = series.reduce((s, r) => s + r.margenNeto, 0) / series.length;
  const avgMargenBruto = series.reduce((s, r) => s + r.margenBruto, 0) / series.length;
  const growth = ((last.ventas - first.ventas) / Math.abs(first.ventas)) * 100;
  const anomalies = series.filter((r) => Math.abs(r.margenBruto - avgMargenBruto) > 12);
  const gFinValues = series.map((r) => r.gastosFinancieros);
  const gFinStable = (Math.max(...gFinValues) - Math.min(...gFinValues)) / (Math.min(...gFinValues) || 1) < 0.3;

  const good: string[] = [];
  const improve: string[] = [];

  if (growth >= 0) good.push(`Las ventas crecieron ${growth >= 0 ? "+" : ""}${growth.toFixed(1)}% entre ${first.period} y ${last.period} — buen trabajo del equipo.`);
  else improve.push(`Las ventas cayeron ${growth.toFixed(1)}% entre ${first.period} y ${last.period} — vale la pena revisar si fue estacionalidad, un cliente perdido, u otra causa puntual.`);

  good.push(`${best.period} fue el mes de mayor facturación del período ($${Math.round(best.ventas).toLocaleString("es-MX")}).`);

  if (avgMargenNeto >= targetMargenNeto) good.push(`El margen neto promedio del período (${avgMargenNeto.toFixed(1)}%) se mantuvo sobre la meta de ${targetMargenNeto}% — la operación siguió siendo rentable.`);
  else improve.push(`El margen neto promedio del período (${avgMargenNeto.toFixed(1)}%) quedó por debajo de la meta de ${targetMargenNeto}% — conviene revisar gastos operativos con el equipo.`);

  if (gFinStable) good.push(`Los gastos financieros se mantuvieron estables mes a mes — buen punto de partida si están negociando condiciones con el banco.`);

  improve.push(`El margen más ajustado se dio en ${worst.period} (${worst.margenNeto.toFixed(1)}% de margen neto) — revisar si fue un mes con gastos puntuales (bonos, mantenimiento, capacitaciones) o una tendencia a corregir.`);

  if (anomalies.length) {
    improve.push(`${anomalies.map((r) => r.period).join(", ")}: el margen bruto se desvía más de 12 puntos del promedio del período — confirma con tu contadora si el costo de ventas está bien registrado ese mes.`);
  }
  improve.push(`No hay una partida visible de provisión de impuesto a la renta en los datos cargados — pregúntale a tu contadora si ya se está apartando ese monto.`);

  return { good, improve };
}
