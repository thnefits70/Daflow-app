"use client";

import { TrendingUp, TrendingDown } from "lucide-react";
import type { StoreFeedbackAggregate } from "@/lib/storeFeedback";
import { retentionRiskFor } from "@/lib/storeFeedbackCalc";

const DRIVERS = [
  { key: "avgFulfillmentScore", label: "Cumplimiento de pedidos" },
  { key: "avgQualityScore", label: "Gestión de garantías" },
  { key: "avgResponseTimeScore", label: "Tiempo de respuesta" },
  { key: "avgCommercialTermsScore", label: "Condiciones comerciales" },
  { key: "avgCommunicationScore", label: "Atención y comunicación" },
] as const;

// Confirmado 2026-08-11: solo resultados agregados por mes, sin nombre de
// tienda ni comentarios — eso queda exclusivo de quien de verdad llama
// (canManageStoreFeedback). Pensado para que Bryan analice qué mejorar sin
// ver el detalle operativo de cada relación comercial.
export function StoreFeedbackKpiPanel({ aggregates }: { aggregates: StoreFeedbackAggregate[] }) {
  if (aggregates.length === 0) {
    return (
      <div>
        <div className="text-[13px] text-steel mb-3.5 max-w-2xl">
          Resultados de solo lectura del feedback mensual a tiendas — sin el detalle de cada llamada, exclusivo de quien evalúa.
        </div>
        <div className="border-[1.5px] border-dashed border-rule rounded-md p-8 text-center text-steel text-[13.5px]">
          Todavía no hay evaluaciones registradas.
        </div>
      </div>
    );
  }

  return (
    <div>
      <div className="text-[13px] text-steel mb-3.5 max-w-2xl">
        Resultados de solo lectura del feedback mensual a tiendas (llamadas hechas por Nairoby) — promedios del 1 al 5 por indicador, para identificar qué mejorar. Sin el detalle de cada llamada.
      </div>
      <div className="flex flex-col gap-2.5">
        {aggregates.map((a) => {
          const risk = retentionRiskFor(a.avgLoyaltyScore);
          const driverValues = DRIVERS.map((d) => ({ ...d, value: a[d.key] as number }));
          const lowest = Math.min(...driverValues.map((d) => d.value));
          const trendDelta = a.prevAvgLoyaltyScore != null ? Math.round((a.avgLoyaltyScore - a.prevAvgLoyaltyScore) * 10) / 10 : null;
          const [y, m] = a.period.split("-");
          const monthLabel = new Date(Number(y), Number(m) - 1, 1).toLocaleDateString("es-MX", { month: "long", year: "numeric" });

          return (
            <div key={a.period} className="bg-surface border border-rule rounded-md p-4">
              <div className="flex items-center justify-between gap-3 flex-wrap mb-3">
                <div className="text-[13.5px] font-bold capitalize">{monthLabel}</div>
                <div className="text-[10.5px] text-steel">{a.storeCount} tienda{a.storeCount === 1 ? "" : "s"} evaluada{a.storeCount === 1 ? "" : "s"}</div>
              </div>

              <div className="flex items-center gap-3 mb-3.5 bg-cloud border border-rule rounded-md px-3.5 py-2.5">
                <div>
                  <div className="text-[10px] uppercase tracking-wide text-steel">Fidelización</div>
                  <div className="text-[20px] font-bold font-mono" style={{ color: risk.color }}>{a.avgLoyaltyScore.toFixed(1)}/5</div>
                </div>
                <div className="text-[12px] font-semibold" style={{ color: risk.color }}>{risk.icon} {risk.label}</div>
                {trendDelta !== null && (
                  <div className={`flex items-center gap-1 text-[11.5px] font-semibold ml-auto ${trendDelta >= 0 ? "text-green" : "text-red"}`}>
                    {trendDelta >= 0 ? <TrendingUp size={13} /> : <TrendingDown size={13} />}
                    {trendDelta >= 0 ? "+" : ""}{trendDelta.toFixed(1)} vs. mes anterior
                  </div>
                )}
              </div>

              <div className="grid grid-cols-2 sm:grid-cols-5 gap-2">
                {driverValues.map((d) => (
                  <div key={d.key} className={`rounded p-2 text-center border ${d.value === lowest ? "border-gold/45 bg-gold/10" : "border-rule bg-cloud"}`}>
                    <div className="text-[9px] uppercase tracking-wide text-steel mb-0.5">{d.label}</div>
                    <div className="text-[14px] font-bold font-mono" style={d.value === lowest ? { color: "#D9A441" } : undefined}>{d.value.toFixed(1)}</div>
                  </div>
                ))}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
