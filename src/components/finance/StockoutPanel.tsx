"use client";

import { useState } from "react";
import { ChevronDown, ChevronUp, ShieldCheck, Zap } from "lucide-react";
import { formatWeekShort } from "@/components/dashboard/WeeklyTrendChart";
import { CatalogCode } from "@/components/shared/CatalogCode";
import type { StockoutWeekDetail } from "@/lib/dashboard";

function formatWeekLabel(week: string) {
  if (!week) return "";
  const [year] = week.split("-W");
  return `${formatWeekShort(week)} · ${year}`;
}

// Confirmado 2026-09-28 con el usuario: la Ruptura de Stock ya no se carga a
// mano — desde la semana 40 se arma sola con los cortes de Fulfillment (ver
// autoStockout.ts). Esta pantalla solo muestra el historial; se quitaron el
// buscador de productos y el botón "sin productos agotados".
export function StockoutPanel({ weeks: weeksAsc }: { weeks: StockoutWeekDetail[] }) {
  const [expanded, setExpanded] = useState(false);
  const weeks = [...weeksAsc].reverse();
  const latest = weeks[0] ?? null;

  const productCount = (w: StockoutWeekDetail) =>
    w.products.length === 0 ? "0 productos (sin ruptura)" : `${w.products.length} producto${w.products.length === 1 ? "" : "s"}`;

  return (
    <div>
      <div className="flex items-start gap-2 bg-surface border border-rule rounded-md p-3.5 mb-5 text-[12px] text-steel">
        <Zap size={14} className="text-teal shrink-0 mt-0.5" />
        <span>
          Se llena sola. Cuando Daniel confirma en un corte que de un producto salió menos de lo pedido, ese producto aparece aquí en esa semana. No hay que marcar nada a mano.
        </span>
      </div>

      {weeks.length === 0 && (
        <div className="border-[1.5px] border-dashed border-rule rounded-md p-8.5 text-center text-steel text-[13.5px]">
          Aún no hay ninguna semana.
        </div>
      )}

      {latest && (
        <div>
          <button
            type="button"
            className="w-full flex items-center justify-between gap-3 bg-surface border border-rule rounded p-3.5 mb-2.5 cursor-pointer"
            onClick={() => setExpanded((v) => !v)}
          >
            {!expanded ? (
              <div className="flex items-center gap-3">
                <span className="font-semibold text-[13.5px]">{formatWeekLabel(latest.week)}</span>
                <span className="text-[12.5px] text-steel">{productCount(latest)} · última semana</span>
              </div>
            ) : (
              <span className="text-[13px] font-semibold">{weeks.length} semanas</span>
            )}
            <span className="inline-flex items-center gap-1 text-[12px] font-semibold text-blue shrink-0">
              {expanded ? "Ocultar" : `Desplegar todas las semanas (${weeks.length})`}
              {expanded ? <ChevronUp size={14} /> : <ChevronDown size={14} />}
            </span>
          </button>

          {(expanded ? weeks : [latest]).map((w) => (
            <div key={w.week} className="bg-surface border border-rule rounded p-3.5 mb-2.5">
              <div className="flex items-center gap-2 mb-2">
                <span className="font-semibold text-[13px]">{formatWeekLabel(w.week)}</span>
                <span className="text-[10.5px] text-steel">{w.auto ? "automático (cortes)" : "cargado a mano"}</span>
              </div>
              <div className="flex flex-wrap gap-2">
                {w.products.length === 0 && (
                  <span className="inline-flex items-center gap-1.5 text-[12px] text-teal">
                    <ShieldCheck size={12} /> Sin productos agotados (0)
                  </span>
                )}
                {w.products.map((p, i) => (
                  <span key={`${p.name}-${i}`} className="inline-flex items-center gap-1.5 text-[12px] bg-cloud border border-rule rounded-full px-2.5 py-1">
                    <CatalogCode code={p.justCode} size="text-[10px]" />
                    <span>{p.name}</span>
                    {p.needed != null && p.out != null && (
                      <span className="text-steel">
                        · salieron {p.out} de {p.needed}
                      </span>
                    )}
                  </span>
                ))}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
