"use client";

import { useMemo, useState } from "react";
import { WeeklyTrendChart, formatMonthShort } from "@/components/dashboard/WeeklyTrendChart";
import { RoiGauge } from "./RoiGauge";
import { EstadoDeResultados } from "./EstadoDeResultados";
import { OtrosIndicadores } from "./OtrosIndicadores";
import { FinancialAnalysis } from "./FinancialAnalysis";
import {
  computeDerived, consolidateMonth, chronoDelta, statusForMargin, marginNetoStatus, buildFinancialAnalysis,
  type FinanceMonthRaw, type FinanceMonthDerived,
} from "@/lib/financeKpisCalc";
import type { FinanceKpiDataDTO } from "@/lib/financeKpis";

function money(v: number) {
  return "$" + Math.round(v).toLocaleString("es-MX");
}
function pct(v: number) {
  return v.toFixed(1) + "%";
}
function pp(v: number) {
  return (v >= 0 ? "+" : "") + v.toFixed(1) + " pp";
}

const GRANULARITY_MONTHS = { monthly: 1, quarterly: 3, semiannual: 6, annual: 12 } as const;

const FLAGSHIP_DEFS = [
  { key: "ventas" as const, title: "Ventas totales", isPercent: false, invert: false },
  { key: "utilidadReportada" as const, title: "Utilidad neta", isPercent: false, invert: false },
  { key: "margenNeto" as const, title: "Margen neto", isPercent: true, invert: false },
  // Gasto: subir es malo (rojo), bajar es bueno (teal) — al revés que las demás.
  { key: "gastosOperativos" as const, title: "Gastos operativos", isPercent: false, invert: true },
];

export function FinanceDashboard({
  deptId,
  data,
  editable,
}: {
  deptId: string;
  data: FinanceKpiDataDTO;
  editable: boolean;
}) {
  const [brand, setBrand] = useState<string>("consolidado");
  const [granularity, setGranularity] = useState<"monthly" | "quarterly" | "semiannual" | "annual" | "custom">("monthly");
  const [yearFilter, setYearFilter] = useState<"current" | "prev">("current");
  const [periodA, setPeriodA] = useState<string | null>(null);
  const [periodB, setPeriodB] = useState<string | null>(null);
  const [customStart, setCustomStart] = useState<string | null>(null);
  const [customEnd, setCustomEnd] = useState<string | null>(null);

  const activeOps = data.operations.filter((o) => o.isActive);
  const todayYear = new Date().getFullYear();

  const series: FinanceMonthDerived[] = useMemo(() => {
    if (brand === "consolidado") {
      const periodsSet = new Set<string>();
      for (const op of activeOps) for (const r of data.recordsByOperation[op.id] ?? []) periodsSet.add(r.period);
      const periods = [...periodsSet].sort();
      return periods.map((period) => {
        const rows = activeOps
          .map((op) => (data.recordsByOperation[op.id] ?? []).find((r) => r.period === period))
          .filter((r): r is FinanceMonthRaw => !!r);
        return computeDerived(consolidateMonth(rows));
      });
    }
    return (data.recordsByOperation[brand] ?? []).slice().sort((a, b) => a.period.localeCompare(b.period)).map(computeDerived);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [brand, data]);

  const windowed = series.slice(-12);

  function sumRaw(rows: FinanceMonthDerived[]): FinanceMonthRaw {
    const sum = (k: keyof FinanceMonthRaw) => rows.reduce((a, r) => a + (r[k] as number), 0);
    return {
      period: `${rows[0].period} → ${rows[rows.length - 1].period}`,
      ventas: sum("ventas"), costoVentas: sum("costoVentas"), gastosVenta: sum("gastosVenta"),
      gastosAdmin: sum("gastosAdmin"), otrosIngresos: sum("otrosIngresos"), gastosFinancieros: sum("gastosFinancieros"),
      otrosGastos: sum("otrosGastos"), roi: null,
    };
  }
  // "Comparar contra" always groups by the same window as "Ver" — except in
  // "Personalizado" mode, where only "Analizar" uses the custom date range
  // (see `curr` below) and this stays a plain single month.
  function getPointByLabel(label: string | null): FinanceMonthDerived | null {
    if (label === null) return null;
    const months = granularity === "custom" ? 1 : GRANULARITY_MONTHS[granularity];
    if (months === 1) return series.find((r) => r.period === label) ?? null;
    const idx = series.findIndex((r) => r.period === label);
    if (idx < months - 1) return null;
    return computeDerived(sumRaw(series.slice(idx - (months - 1), idx + 1)));
  }
  function getRangePoint(start: string | null, end: string | null): FinanceMonthDerived | null {
    if (!start || !end || start > end) return null;
    const rows = series.filter((r) => r.period >= start && r.period <= end);
    if (rows.length === 0) return null;
    return computeDerived(sumRaw(rows));
  }

  const periodAOptionsAll = series.filter((r) => r.period.startsWith(String(yearFilter === "current" ? todayYear : todayYear - 1)));
  const effectivePeriodA = periodA && periodAOptionsAll.some((r) => r.period === periodA) ? periodA : periodAOptionsAll[periodAOptionsAll.length - 1]?.period ?? null;
  const byYear = new Map<string, FinanceMonthDerived[]>();
  for (const r of series) {
    const y = r.period.split("-")[0];
    if (!byYear.has(y)) byYear.set(y, []);
    byYear.get(y)!.push(r);
  }
  const years = [...byYear.keys()].sort().reverse();
  const idxOfA = series.findIndex((r) => r.period === (granularity === "custom" ? customEnd : effectivePeriodA));
  const defaultB = idxOfA > 0 ? series[idxOfA - 1].period : series[series.length - 1]?.period ?? null;
  const effectivePeriodB = periodB && series.some((r) => r.period === periodB) ? periodB : defaultB;

  // In "Personalizado" mode, "Analizar" is the custom Desde/Hasta range
  // instead of a single labeled period — customEnd still anchors the A/B
  // bracket's visual position on the chart, same as any other granularity's
  // ending month.
  const effectiveLabelA = granularity === "custom" ? customEnd : effectivePeriodA;
  const curr = granularity === "custom" ? getRangePoint(customStart, customEnd) : getPointByLabel(effectivePeriodA);
  const base = getPointByLabel(effectivePeriodB);

  if (series.length === 0) {
    return (
      <div className="border-[1.5px] border-dashed border-rule rounded-md p-10 text-center text-steel text-[13.5px]">
        Aún no hay meses cargados para {brand === "consolidado" ? "ninguna operación" : "esta operación"}.
        {editable && " Ve a \"Cargar plantilla\" para subir el primero."}
      </div>
    );
  }

  const analysis = buildFinancialAnalysis(windowed, data.settings.targetMargenNeto);
  const netoStatus = curr ? marginNetoStatus(curr.margenNeto, { alerta: data.settings.targetMargenNeto, excelente: data.settings.excelenteMargenNeto }) : null;
  const netoColor = netoStatus ? { good: "#22a67e", crit: "#e0574a", excelente: "#14c7c7" }[netoStatus.cls] : "#f1f5fb";

  const compIsConsolidado = brand === "consolidado";
  const compSegs = curr
    ? compIsConsolidado
      ? activeOps.map((op, i) => {
          const row = (data.recordsByOperation[op.id] ?? []).find((r) => r.period === curr.period);
          return { label: op.name, val: row?.ventas ?? 0, color: i === 0 ? "#1e5eff" : "#14c7c7" };
        })
      : [
          { label: "Gastos de venta", val: curr.gastosVenta, color: "#1e5eff" },
          { label: "Gastos administrativos", val: curr.gastosAdmin, color: "#14c7c7" },
        ]
    : [];
  const compTotal = compSegs.reduce((a, s) => a + s.val, 0) || 1;

  return (
    <div>
      <div className="flex flex-wrap items-end gap-4.5 mb-5 bg-surface border border-rule rounded-md p-3.5">
        <div>
          <div className="text-[10px] uppercase tracking-wide text-steel font-bold mb-1.5">Marca / operación</div>
          <div className="flex gap-1 bg-cloud border border-rule rounded-md p-1">
            {data.operations.map((op) => (
              <button
                key={op.id}
                type="button"
                disabled={!op.isActive}
                title={!op.isActive ? "Aún no habilitada" : undefined}
                className={`px-3 py-1.5 rounded text-[12px] font-semibold cursor-pointer disabled:opacity-40 disabled:cursor-not-allowed ${
                  brand === op.id ? "bg-blue text-white" : "text-steel"
                }`}
                onClick={() => setBrand(op.id)}
              >
                {op.name}{!op.isActive && " (próx.)"}
              </button>
            ))}
            <button
              type="button"
              className={`px-3 py-1.5 rounded text-[12px] font-semibold cursor-pointer ${brand === "consolidado" ? "bg-teal text-navy" : "text-steel"}`}
              onClick={() => setBrand("consolidado")}
            >
              🔗 Consolidado
            </button>
          </div>
        </div>
        <div>
          <div className="text-[10px] uppercase tracking-wide text-steel font-bold mb-1.5">Ver</div>
          <div className="flex gap-1 bg-cloud border border-rule rounded-md p-1 flex-wrap">
            <button type="button" className={`px-3 py-1.5 rounded text-[12px] font-semibold cursor-pointer ${granularity === "monthly" ? "bg-blue text-white" : "text-steel"}`} onClick={() => setGranularity("monthly")}>Mensual</button>
            <button type="button" className={`px-3 py-1.5 rounded text-[12px] font-semibold cursor-pointer ${granularity === "quarterly" ? "bg-blue text-white" : "text-steel"}`} onClick={() => setGranularity("quarterly")}>Trimestral</button>
            <button type="button" className={`px-3 py-1.5 rounded text-[12px] font-semibold cursor-pointer ${granularity === "semiannual" ? "bg-blue text-white" : "text-steel"}`} onClick={() => setGranularity("semiannual")}>Semestral</button>
            <button type="button" className={`px-3 py-1.5 rounded text-[12px] font-semibold cursor-pointer ${granularity === "annual" ? "bg-blue text-white" : "text-steel"}`} onClick={() => setGranularity("annual")}>Anual</button>
            <button type="button" className={`px-3 py-1.5 rounded text-[12px] font-semibold cursor-pointer ${granularity === "custom" ? "bg-teal text-navy" : "text-steel"}`} onClick={() => setGranularity("custom")}>Personalizado</button>
          </div>
        </div>
        {granularity !== "custom" && (
          <div>
            <div className="text-[10px] uppercase tracking-wide text-steel font-bold mb-1.5">Año</div>
            <div className="flex gap-1 bg-cloud border border-rule rounded-md p-1">
              <button type="button" className={`px-3 py-1.5 rounded text-[12px] font-semibold cursor-pointer ${yearFilter === "current" ? "bg-blue text-white" : "text-steel"}`} onClick={() => setYearFilter("current")}>Año actual</button>
              <button type="button" className={`px-3 py-1.5 rounded text-[12px] font-semibold cursor-pointer ${yearFilter === "prev" ? "bg-blue text-white" : "text-steel"}`} onClick={() => setYearFilter("prev")}>Año pasado</button>
            </div>
          </div>
        )}
        {granularity === "custom" ? (
          <div>
            <div className="text-[10px] uppercase tracking-wide text-steel font-bold mb-1.5">Analizar — rango personalizado</div>
            <div className="flex items-center gap-1.5">
              <input
                type="month"
                className="rounded border border-rule bg-cloud px-2.5 py-1.5 text-[12px]"
                value={customStart ?? ""}
                onChange={(e) => setCustomStart(e.target.value || null)}
              />
              <span className="text-steel text-[12px]">a</span>
              <input
                type="month"
                className="rounded border border-rule bg-cloud px-2.5 py-1.5 text-[12px]"
                value={customEnd ?? ""}
                onChange={(e) => setCustomEnd(e.target.value || null)}
              />
            </div>
          </div>
        ) : (
          <div>
            <div className="text-[10px] uppercase tracking-wide text-steel font-bold mb-1.5">Analizar</div>
            <select className="rounded border border-rule bg-cloud px-2.5 py-1.5 text-[12px]" value={effectivePeriodA ?? ""} onChange={(e) => setPeriodA(e.target.value)}>
              {periodAOptionsAll.length === 0 && <option value="">Sin datos para {yearFilter === "current" ? todayYear : todayYear - 1}</option>}
              {periodAOptionsAll.map((r) => <option key={r.period} value={r.period}>{formatMonthShort(r.period)}</option>)}
            </select>
          </div>
        )}
        <div>
          <div className="text-[10px] uppercase tracking-wide text-steel font-bold mb-1.5">Comparar contra (cualquier mes, cualquier año)</div>
          <select className="rounded border border-rule bg-cloud px-2.5 py-1.5 text-[12px]" value={effectivePeriodB ?? ""} onChange={(e) => setPeriodB(e.target.value)}>
            {years.map((y) => (
              <optgroup key={y} label={y}>
                {byYear.get(y)!.map((r) => <option key={r.period} value={r.period}>{formatMonthShort(r.period)}</option>)}
              </optgroup>
            ))}
          </select>
        </div>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3.5 mb-5">
        {FLAGSHIP_DEFS.map((def) => {
          const points = windowed.map((r) => ({ week: r.period, value: r[def.key] as number }));
          const idxA = effectiveLabelA ? windowed.findIndex((r) => r.period === effectiveLabelA) : -1;
          const idxB = effectivePeriodB ? windowed.findIndex((r) => r.period === effectivePeriodB) : -1;
          const valA = curr?.[def.key] as number | undefined;
          const valB = base?.[def.key] as number | undefined;
          let deltaNode: React.ReactNode = null;
          if (curr && base) {
            const { pctDiff, moneyDiff } = chronoDelta(curr, curr.period, base, base.period, def.key, def.isPercent);
            const good = def.invert ? pctDiff <= 0 : pctDiff >= 0;
            const cls = Math.abs(pctDiff) < 0.05 ? "text-steel" : good ? "text-teal" : "text-red";
            const sign = pctDiff >= 0 ? "+" : "";
            const pctText = def.isPercent ? pp(pctDiff) : `${sign}${pctDiff.toFixed(1)}%`;
            const moneyText = def.isPercent ? "" : ` · ${moneyDiff >= 0 ? "+" : ""}${money(moneyDiff)}`;
            deltaNode = <span className={`font-mono text-[11px] font-bold ${cls}`}>{pctText}{moneyText}</span>;
          }
          return (
            <div key={def.key} className="bg-surface border border-rule rounded-md p-4.5">
              <div className="font-mono text-[10px] uppercase tracking-wide text-steel font-bold mb-1">{def.title} · últimos 12 meses</div>
              <div className="font-display text-[26px] font-bold">{valA !== undefined ? (def.isPercent ? pct(valA) : money(valA)) : "—"}</div>
              {base && (
                <div className="text-[11.5px] text-steel mb-2">
                  {def.title} <b>{formatMonthShort(base.period)}</b>: <b>{def.isPercent ? pct(valB!) : money(valB!)}</b> {deltaNode}
                </div>
              )}
              <WeeklyTrendChart
                label={def.title}
                deptName=""
                points={points}
                format={def.isPercent ? "percent" : "count"}
                valueFormat={def.isPercent ? undefined : money}
                periodLabel={formatMonthShort}
                latestLabel="último mes"
                colorDotsByDirection
                invertDirection={def.invert}
                compareIndexA={idxA >= 0 ? idxA : undefined}
                compareIndexB={idxB >= 0 ? idxB : undefined}
              />
            </div>
          );
        })}
      </div>

      {curr && (
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-3.5 mb-5">
          {[
            { lbl: "Margen bruto", val: curr.margenBruto, target: data.settings.targetMargenBruto },
            { lbl: "Margen operativo", val: curr.margenOperativo, target: data.settings.targetMargenOperativo },
          ].map((m) => {
            const st = statusForMargin(m.val, m.target);
            const color = { good: "#22a67e", warn: "#d9a441", crit: "#e0574a" }[st.cls];
            return (
              <div key={m.lbl} className="bg-surface border border-rule rounded-md p-4">
                <div className="flex items-baseline justify-between mb-2">
                  <span className="text-[11px] text-steel">{m.lbl}</span>
                  <span className="font-display font-bold text-[17px]" style={{ color }}>{pct(m.val)}</span>
                </div>
                <div className="h-2 rounded-full overflow-hidden" style={{ background: `${color}22` }}>
                  <div className="h-full rounded-full" style={{ width: `${Math.max(0, Math.min(100, (m.val / m.target) * 100))}%`, background: color }} />
                </div>
                <div className="text-[10px] text-steel mt-1.5 font-mono">meta {m.target}%</div>
              </div>
            );
          })}
          <div className="bg-surface border border-rule rounded-md p-4">
            <div className="flex items-baseline justify-between mb-2">
              <span className="text-[11px] text-steel">Margen neto</span>
              <span className="font-display font-bold text-[17px]" style={{ color: netoColor }}>{pct(curr.margenNeto)}</span>
            </div>
            <div className="h-2 rounded-full overflow-hidden" style={{ background: `${netoColor}22` }}>
              <div className="h-full rounded-full" style={{ width: `${Math.max(0, Math.min(100, (curr.margenNeto / data.settings.excelenteMargenNeto) * 100))}%`, background: netoColor }} />
            </div>
            <div className="text-[10px] mt-1.5" style={{ color: netoColor }}>{netoStatus?.icon} {netoStatus?.label}</div>
            <div className="text-[9px] text-steel mt-1">
              🔴&lt;{data.settings.targetMargenNeto}% · 🟢{data.settings.targetMargenNeto}-{data.settings.excelenteMargenNeto}% · 🌟&gt;{data.settings.excelenteMargenNeto}%
            </div>
          </div>
        </div>
      )}

      {curr && (
        <div className="bg-surface border border-rule rounded-md p-4.5 mb-5">
          <div className="font-mono text-[10px] uppercase tracking-wide text-steel font-bold mb-3">ROI</div>
          <RoiGauge
            value={curr.roi}
            compareValue={base?.roi}
            compareLabel={base ? formatMonthShort(base.period) : undefined}
            bands={{
              red: data.settings.roiBandRed,
              yellow: data.settings.roiBandYellow,
              target: data.settings.roiBandTarget,
              excellent: data.settings.roiBandExcellent,
            }}
          />
        </div>
      )}

      {curr && compSegs.length > 0 && (
        <div className="bg-surface border border-rule rounded-md p-4.5 mb-5">
          <div className="font-mono text-[10px] uppercase tracking-wide text-steel font-bold mb-3">
            Composición del período — {compIsConsolidado ? "ventas por marca" : "gastos operativos"}
          </div>
          <div className="flex h-6.5 rounded-md overflow-hidden mb-2.5">
            {compSegs.map((s) => {
              const w = (s.val / compTotal) * 100;
              return <div key={s.label} style={{ width: `${w}%`, background: s.color }} className="flex items-center justify-center text-[10.5px] font-bold text-navy">{w > 12 ? `${Math.round(w)}%` : ""}</div>;
            })}
          </div>
          <div className="flex gap-4 flex-wrap text-[11.5px] text-steel">
            {compSegs.map((s) => (
              <span key={s.label} className="flex items-center gap-1.5">
                <span className="w-2.5 h-2.5 rounded-sm" style={{ background: s.color }} /> {s.label} · {money(s.val)}
              </span>
            ))}
          </div>
        </div>
      )}

      <div className="bg-surface border border-rule rounded-md p-4.5 mb-5">
        <div className="font-mono text-[10px] uppercase tracking-wide text-steel font-bold mb-3">Estado de resultados</div>
        <EstadoDeResultados series={windowed} />
      </div>

      {curr && (
        <div className="bg-surface border border-rule rounded-md p-4.5 mb-5">
          <div className="font-mono text-[10px] uppercase tracking-wide text-steel font-bold mb-3">Otros indicadores</div>
          <OtrosIndicadores
            deptId={deptId}
            brand={brand}
            current={curr}
            previous={base}
            sharedBalances={data.sharedBalances}
            taxRatePct={data.settings.taxRatePct}
            editable={editable}
          />
        </div>
      )}

      <div className="bg-surface border border-rule rounded-md p-4.5">
        <div className="font-mono text-[10px] uppercase tracking-wide text-steel font-bold mb-3">Análisis financiero</div>
        <FinancialAnalysis good={analysis.good} improve={analysis.improve} />
      </div>
    </div>
  );
}
