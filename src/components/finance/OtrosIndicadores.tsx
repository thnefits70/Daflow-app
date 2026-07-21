"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { computeEbitda, computeTaxProvision, workingCapitalDays, type FinanceMonthDerived } from "@/lib/financeKpisCalc";
import type { FinanceSharedBalanceDTO } from "@/lib/financeKpis";

function money(v: number) {
  return "$" + Math.round(v).toLocaleString("es-MX");
}
const MONTH_NAMES = ["Ene", "Feb", "Mar", "Abr", "May", "Jun", "Jul", "Ago", "Sep", "Oct", "Nov", "Dic"];
function monthLabel(period: string) {
  const [y, m] = period.split("-");
  return `${MONTH_NAMES[Number(m) - 1] ?? m} ${y}`;
}

export function OtrosIndicadores({
  deptId,
  brand,
  current,
  previous,
  sharedBalances,
  taxRatePct,
  editable,
}: {
  deptId: string;
  brand: string;
  current: FinanceMonthDerived;
  previous: FinanceMonthDerived | null;
  sharedBalances: FinanceSharedBalanceDTO[];
  taxRatePct: number;
  editable: boolean;
}) {
  const router = useRouter();
  const [rate, setRate] = useState(String(taxRatePct));
  const [savingRate, setSavingRate] = useState(false);

  async function saveRate() {
    const v = Number(rate);
    if (Number.isNaN(v) || v < 0 || v > 100) return;
    setSavingRate(true);
    await fetch("/api/finance-kpis/settings", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ deptId, taxRatePct: v }),
    });
    setSavingRate(false);
    router.refresh();
  }

  const DA_PCT = 0.15; // depreciación/amortización estimada — placeholder hasta tener el dato real
  const { da, ebitda } = computeEbitda(current, DA_PCT);
  const { impuesto, utilidadDespuesImpuesto } = computeTaxProvision(current, taxRatePct);

  const balCurrent = sharedBalances.find((b) => b.period === current.period) ?? null;
  const balPrevious = previous ? sharedBalances.find((b) => b.period === previous.period) ?? null : null;
  const isConsolidado = brand === "consolidado";

  function workingCapitalTile(label: string, balanceKey: "inventarioFinal" | "cuentasPorCobrar" | "cuentasPorPagar", flow: number) {
    const curVal = balCurrent?.[balanceKey];
    if (isConsolidado && curVal !== undefined && curVal !== null) {
      const prevVal = balPrevious?.[balanceKey] ?? null;
      const days = workingCapitalDays(curVal, prevVal, flow);
      const trend = prevVal !== null ? (curVal >= prevVal ? `▲ subió de ${money(prevVal)}` : `▼ bajó de ${money(prevVal)}`) : "sin mes anterior para comparar";
      return { days, node: (
        <div className="bg-cloud rounded-md p-3" style={{ background: "rgba(20,199,199,.08)" }}>
          <div className="text-[9.5px] uppercase tracking-wide text-steel mb-1.5">{label} — real</div>
          <div className="font-display text-[19px] font-bold text-teal">{days !== null ? days.toFixed(0) : "—"}</div>
          <div className="text-[10px] text-steel mt-1">{monthLabel(current.period)}: {money(curVal)} ({trend})</div>
        </div>
      ) };
    }
    if (!isConsolidado) {
      return { days: null, node: (
        <div className="bg-cloud rounded-md p-3 text-left">
          <div className="text-[9.5px] uppercase tracking-wide text-steel mb-1.5">{label}</div>
          <div className="text-[11px] text-steel leading-relaxed">No se puede calcular por marca — es una sola operación compartida. Cambia a &quot;Consolidado&quot; para verlo.</div>
        </div>
      ) };
    }
    return { days: null, node: (
      <div className="bg-cloud rounded-md p-3">
        <div className="text-[9.5px] uppercase tracking-wide text-steel mb-1.5">{label}</div>
        <div className="font-display text-[19px] font-bold">—</div>
      </div>
    ) };
  }

  const dio = workingCapitalTile("Días de inventario (DIO)", "inventarioFinal", current.costoVentas);
  const dso = workingCapitalTile("Días de cartera (DSO)", "cuentasPorCobrar", current.ventas);
  const dpo = workingCapitalTile("Días a proveedores (DPO)", "cuentasPorPagar", current.costoVentas);
  const ccc = dio.days !== null && dso.days !== null && dpo.days !== null ? dio.days + dso.days - dpo.days : null;

  return (
    <div>
      <div className="mb-5.5 pb-5.5 border-b border-dashed border-rule">
        <div className="flex items-center justify-between flex-wrap gap-2.5 mb-3">
          <div className="font-semibold text-[13.5px]">EBITDA y provisión de impuesto — {monthLabel(current.period)}</div>
          {editable && (
            <div className="flex items-center gap-1.5">
              <label className="text-[11px] text-steel">Tasa de impuesto a la renta</label>
              <input
                type="number" min={0} max={100} step={0.5}
                className="w-16 rounded border border-rule bg-cloud px-2 py-1 text-[12px] font-mono text-right"
                value={rate}
                onChange={(e) => setRate(e.target.value)}
                onBlur={saveRate}
                disabled={savingRate}
              />
              <span className="text-[11px] text-steel">%</span>
            </div>
          )}
        </div>
        <table className="w-full text-[12.5px]">
          <tbody>
            <tr><td className="py-1">Utilidad operativa</td><td className="py-1 text-right font-mono">{money(current.utilidadOperativa)}</td></tr>
            <tr><td className="py-1">+ Depreciación y amortización (estimado, {(DA_PCT * 100).toFixed(0)}% de gastos admin.)</td><td className="py-1 text-right font-mono">{money(da)}</td></tr>
            <tr className="border-t border-rule font-bold text-teal"><td className="py-1.5 pt-2">= EBITDA</td><td className="py-1.5 pt-2 text-right font-mono">{money(ebitda)}</td></tr>
            <tr><td className="py-1 pt-3.5">Utilidad neta (antes de impuesto)</td><td className="py-1 pt-3.5 text-right font-mono">{money(current.utilidadReportada)}</td></tr>
            <tr><td className="py-1">− Provisión de impuesto a la renta ({taxRatePct.toFixed(1)}%)</td><td className="py-1 text-right font-mono">−{money(impuesto)}</td></tr>
            <tr className="border-t border-rule font-bold"><td className="py-1.5 pt-2">= Utilidad neta después de impuesto</td><td className="py-1.5 pt-2 text-right font-mono">{money(utilidadDespuesImpuesto)}</td></tr>
          </tbody>
        </table>
      </div>

      <div>
        <div className="flex items-center justify-between flex-wrap gap-2 mb-3">
          <div className="font-semibold text-[13.5px]">Capital de trabajo</div>
          <div className="text-[11px] text-steel">real en vista Consolidado — inventario, cartera y proveedores</div>
        </div>
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-2.5">
          {dso.node}
          {dio.node}
          {dpo.node}
          <div className="rounded-md p-3" style={{ background: "rgba(217,164,65,.08)" }}>
            <div className="text-[9.5px] uppercase tracking-wide text-steel mb-1.5">Ciclo de conversión de efectivo</div>
            <div className="font-display text-[19px] font-bold" style={{ color: "#D9A441" }}>{ccc !== null ? `${ccc.toFixed(0)} días` : "—"}</div>
            {ccc !== null && <div className="text-[9.5px] text-steel mt-1">DIO + DSO − DPO</div>}
          </div>
        </div>
      </div>
    </div>
  );
}
