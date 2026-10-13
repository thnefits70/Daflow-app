"use client";

import { useState } from "react";
import { X } from "lucide-react";
import { WeeklyTrendChart, formatIsoWeekRangeLabel, formatWeekShort, type WeeklyPoint } from "./WeeklyTrendChart";
import { useBackButtonGuard } from "@/lib/useBackButtonGuard";
import type { DispatchedDailyBreakdown } from "@/lib/dispatchedDaily";

const WEEKDAYS = ["Lun", "Mar", "Mié", "Jue", "Vie", "Sáb", "Dom"];
const n = (v: number) => v.toLocaleString("es-MX");

// Pedido de Daniel 2026-10-13: "Pedidos despachados" con clic en la semana
// para verla por día (ver dispatchedDaily.ts). Mismo gráfico de siempre en
// Inicio (empleados) y en el panel del admin.
export function DispatchedOrdersTrend({ deptName, points }: { deptName: string; points: WeeklyPoint[] }) {
  const [week, setWeek] = useState<string | null>(null);
  const [data, setData] = useState<DispatchedDailyBreakdown | null>(null);
  const [error, setError] = useState("");
  useBackButtonGuard(week !== null, () => setWeek(null));

  function open(w: string) {
    setWeek(w);
    setData(null);
    setError("");
    fetch(`/api/weekly-metrics/daily?week=${w}`)
      .then(async (r) => {
        const d = await r.json().catch(() => null);
        if (!r.ok) throw new Error(d?.error ?? "No se pudo cargar.");
        setData(d);
      })
      .catch((e) => setError(e instanceof Error ? e.message : "No se pudo cargar."));
  }

  const last = points[points.length - 1];
  const brandLabels = data ? [...new Set(data.days.flatMap((d) => d.brands.map((b) => b.label)))] : [];
  // Domingo solo si tuvo algo.
  const days = data ? data.days.filter((d, i) => i < 6 || d.guides + d.externalSales + d.cancelledReported > 0) : [];
  const sum = (f: (d: DispatchedDailyBreakdown["days"][number]) => number) => days.reduce((a, d) => a + f(d), 0);
  const anyCancelled = days.some((d) => d.cancelledInCut > 0 || d.cancelledReported > 0);

  return (
    <>
      <WeeklyTrendChart
        label="Pedidos despachados"
        deptName={deptName}
        points={points}
        weeklyGoal={6000}
        dailyDivisor={6}
        liveNote="Se actualiza sola cada vez que un corte se envía a Inventario — no es un número cerrado todavía."
        latestCaption={`≈ ${Math.round(last.value / 6).toLocaleString("es-MX")} pedidos/día en promedio (lunes a sábado)`}
        onPointClick={open}
      />

      {week && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4" onClick={() => setWeek(null)}>
          <div className="bg-surface border border-rule rounded-lg w-full max-w-4xl max-h-[90vh] overflow-y-auto p-5" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-start justify-between gap-3 mb-3">
              <div>
                <div className="text-[11px] font-semibold uppercase tracking-wide text-steel">Pedidos despachados por día</div>
                <div className="text-[16px] font-bold text-ink">
                  {formatWeekShort(week)} · {formatIsoWeekRangeLabel(week)}
                </div>
              </div>
              <button type="button" aria-label="Cerrar" className="text-steel hover:text-ink cursor-pointer" onClick={() => setWeek(null)}>
                <X size={18} />
              </button>
            </div>

            {error && <div className="text-red text-[12.5px]">{error}</div>}
            {!data && !error && <div className="text-[12.5px] text-steel">Cargando…</div>}

            {data && (
              <>
                <div className="overflow-x-auto">
                  <table className="w-full text-[12px] border-collapse">
                    <thead>
                      <tr className="text-steel text-left border-b border-rule">
                        <th className="py-1.5 pr-3 font-semibold">Día</th>
                        {brandLabels.map((b) => (
                          <th key={b} className="py-1.5 px-2 font-semibold text-right whitespace-nowrap">{b}</th>
                        ))}
                        <th className="py-1.5 px-2 font-semibold text-right whitespace-nowrap">Guías</th>
                        <th className="py-1.5 px-2 font-semibold text-right whitespace-nowrap">− Falta de stock</th>
                        <th className="py-1.5 px-2 font-semibold text-right whitespace-nowrap">+ Ventas externas</th>
                        <th className="py-1.5 px-2 font-semibold text-right whitespace-nowrap text-ink">= Despachados</th>
                        {anyCancelled && <th className="py-1.5 pl-2 font-semibold text-right whitespace-nowrap">Canceladas</th>}
                      </tr>
                    </thead>
                    <tbody>
                      {days.map((d) => {
                        const idx = data.days.indexOf(d);
                        const empty = d.guides + d.externalSales === 0;
                        return (
                          <tr key={d.day} className={`border-b border-rule/60 ${empty ? "text-steel" : "text-ink"}`}>
                            <td className="py-1.5 pr-3 whitespace-nowrap">
                              {WEEKDAYS[idx]} {d.day.slice(8, 10)}/{d.day.slice(5, 7)}
                            </td>
                            {brandLabels.map((b) => (
                              <td key={b} className="py-1.5 px-2 text-right font-mono">{n(d.brands.find((x) => x.label === b)?.value ?? 0)}</td>
                            ))}
                            <td className="py-1.5 px-2 text-right font-mono">{n(d.guides)}</td>
                            <td className="py-1.5 px-2 text-right font-mono" style={d.outOfStock ? { color: "#FF9B90" } : undefined}>
                              {d.outOfStock ? `−${n(d.outOfStock)}` : "0"}
                            </td>
                            <td className="py-1.5 px-2 text-right font-mono">{d.externalSales ? `+${n(d.externalSales)}` : "0"}</td>
                            <td className="py-1.5 px-2 text-right font-mono font-bold">{n(d.dispatched)}</td>
                            {anyCancelled && (
                              <td className="py-1.5 pl-2 text-right font-mono" style={d.cancelledInCut ? { color: "#D9A441" } : undefined}>
                                {d.cancelledInCut || d.cancelledReported
                                  ? `${n(d.cancelledInCut)}${d.cancelledReported !== d.cancelledInCut ? ` (${n(d.cancelledReported)} reportadas)` : ""}`
                                  : "0"}
                              </td>
                            )}
                          </tr>
                        );
                      })}
                      <tr className="font-bold text-ink">
                        <td className="py-2 pr-3">Total</td>
                        {brandLabels.map((b) => (
                          <td key={b} className="py-2 px-2 text-right font-mono">{n(sum((d) => d.brands.find((x) => x.label === b)?.value ?? 0))}</td>
                        ))}
                        <td className="py-2 px-2 text-right font-mono">{n(sum((d) => d.guides))}</td>
                        <td className="py-2 px-2 text-right font-mono">−{n(sum((d) => d.outOfStock))}</td>
                        <td className="py-2 px-2 text-right font-mono">+{n(sum((d) => d.externalSales))}</td>
                        <td className="py-2 px-2 text-right font-mono">{n(sum((d) => d.dispatched) - data.manualWeekly)}</td>
                        {anyCancelled && <td className="py-2 pl-2 text-right font-mono">{n(sum((d) => d.cancelledInCut))}</td>}
                      </tr>
                    </tbody>
                  </table>
                </div>
                <div className="mt-3 flex flex-col gap-1 text-[11.5px] text-steel">
                  <div>Las columnas por marca son las guías de los cortes de ese día. Despachados = guías − falta de stock + ventas externas entregadas.</div>
                  {data.manualWeekly > 0 && (
                    <div>Esta semana además resta {n(data.manualWeekly)} preparadas/generadas que se anotaron a mano para toda la semana (no se pueden repartir por día).</div>
                  )}
                  {anyCancelled && (
                    <div>
                      <span style={{ color: "#D9A441" }}>Canceladas</span>: guías de los cortes de ese día que después se reportaron como canceladas — hoy
                      siguen sumando en despachados. Entre paréntesis, las reportadas ese día en total (algunas pueden ser de otros días o de guías que no
                      estaban en un corte).
                    </div>
                  )}
                </div>
              </>
            )}
          </div>
        </div>
      )}
    </>
  );
}
