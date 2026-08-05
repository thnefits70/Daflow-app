"use client";

import type { InventoryKpisDataDTO } from "@/lib/inventoryKpis";
import { quarterLabel, staleBucket } from "@/lib/inventoryKpisCalc";
import { TrendSpark } from "@/components/shared/TrendSpark";

const MONTH_NAMES = ["Ene", "Feb", "Mar", "Abr", "May", "Jun", "Jul", "Ago", "Sep", "Oct", "Nov", "Dic"];
function monthLabel(period: string) {
  const [y, m] = period.split("-");
  return `${MONTH_NAMES[Number(m) - 1] ?? m} ${y}`;
}
function money(v: number) {
  return "$" + Math.round(v).toLocaleString("es-MX");
}

export function InventoryKpisPanel({ data }: { data: InventoryKpisDataDTO }) {
  if (!data.hasData) {
    return (
      <div className="text-[13px] text-steel border border-dashed border-rule rounded-md p-6 text-center">
        Todavía no hay datos suficientes de Finanzas + Inventario para calcular estos KPIs. En cuanto Daniel cargue el
        primer valor de inventario en &quot;Control de Inventario&quot;, esta pestaña empieza a mostrar información.
      </div>
    );
  }

  const lastPeriod = data.series[data.series.length - 1]?.period;
  const { staleSummary } = data;

  return (
    <div className="grid grid-cols-1 sm:grid-cols-2 gap-3.5">
      {/* 1. Rotación / DIO */}
      <div className="bg-surface border border-rule rounded-md p-4.5" style={{ borderTop: "2px solid #14c7c7" }}>
        <div className="flex items-center justify-between mb-1">
          <div className="font-semibold text-[13.5px]">Rotación de inventario (DIO)</div>
          {lastPeriod && <span className="font-mono text-[10px] uppercase text-steel bg-cloud rounded-full px-2 py-0.5">{monthLabel(lastPeriod)}</span>}
        </div>
        <div className="flex items-baseline gap-2 mt-2">
          <div className="font-display text-[30px] font-bold">{data.dio.current !== null ? data.dio.current.toFixed(0) : "—"}</div>
          <div className="text-[11px] text-steel">días</div>
        </div>
        <div className="text-[11px] text-steel mt-1">
          {data.dio.good === false ? "Subiendo = mal (rota más lento)" : data.dio.good === true ? "Bajando = bien (rota más rápido)" : "Sin tendencia todavía"}
        </div>
        <TrendSpark values={data.dioSeries} good={data.dio.good} />
      </div>

      {/* 2. Inventario vs Ventas */}
      <div className="bg-surface border border-rule rounded-md p-4.5" style={{ borderTop: "2px solid #1e5eff" }}>
        <div className="flex items-center justify-between mb-1">
          <div className="font-semibold text-[13.5px]">Inventario vs. Ventas (mensual)</div>
          {lastPeriod && <span className="font-mono text-[10px] uppercase text-steel bg-cloud rounded-full px-2 py-0.5">{monthLabel(lastPeriod)}</span>}
        </div>
        <div className="text-[11px] text-steel mt-2 mb-2">
          Si el inventario sube mientras las ventas no acompañan, es señal temprana de sobrestock.
        </div>
        <div className="flex flex-col gap-1 mt-2">
          {data.series.slice(-6).map((p) => (
            <div key={p.period} className="flex items-center gap-2 text-[11px]">
              <span className="w-10 text-steel font-mono">{monthLabel(p.period).slice(0, 3)}</span>
              <div className="flex-1 flex items-center gap-1">
                <div className="h-2 rounded bg-cloud flex-1 relative overflow-hidden">
                  <div className="h-full bg-blue/70 absolute left-0 top-0" style={{ width: p.inventario !== null && data.series.length ? `${Math.min(100, (p.inventario / Math.max(...data.series.map((s) => s.inventario ?? 0), 1)) * 100)}%` : "0%" }} />
                </div>
              </div>
              <span className="font-mono text-steel w-20 text-right">{p.inventario !== null ? money(p.inventario) : "—"}</span>
            </div>
          ))}
        </div>
        {data.overstockAlert.alert && (
          <div className="mt-3 flex items-center gap-2 text-[12px] bg-red/10 border border-red/30 text-red rounded-md px-3 py-2">
            <span className="w-1.5 h-1.5 rounded-full bg-red shrink-0" /> {data.overstockAlert.message}
          </div>
        )}
      </div>

      {/* 3. GMROI */}
      <div className="bg-surface border border-rule rounded-md p-4.5" style={{ borderTop: "2px solid #22a67e" }}>
        <div className="flex items-center justify-between mb-1">
          <div className="font-semibold text-[13.5px]">GMROI</div>
          {lastPeriod && <span className="font-mono text-[10px] uppercase text-steel bg-cloud rounded-full px-2 py-0.5">{monthLabel(lastPeriod)}</span>}
        </div>
        <div className="flex items-baseline gap-2 mt-2">
          <div className="font-display text-[30px] font-bold">{data.gmroiSeries.current !== null ? data.gmroiSeries.current.toFixed(1) : "—"}</div>
          <div className="text-[11px] text-steel">x</div>
        </div>
        <div className="text-[11px] text-steel mt-1">Utilidad bruta ÷ inventario promedio</div>
        {data.gmroiSeries.good !== null && (
          <div className={`mt-2 flex items-center gap-2 text-[12px] rounded-md px-3 py-1.5 ${data.gmroiSeries.good ? "bg-green/10 border border-green/30 text-green" : "bg-red/10 border border-red/30 text-red"}`}>
            <span className={`w-1.5 h-1.5 rounded-full shrink-0 ${data.gmroiSeries.good ? "bg-green" : "bg-red"}`} />
            {data.gmroiSeries.good ? "Mejorando vs. el mes anterior" : "Cayendo vs. el mes anterior"}
          </div>
        )}
        <TrendSpark values={data.gmroiFullSeries} good={data.gmroiSeries.good} />
      </div>

      {/* 4. Productos sin movimiento */}
      <div className="bg-surface border border-rule rounded-md p-4.5" style={{ borderTop: "2px solid #e0574a" }}>
        <div className="flex items-center justify-between mb-1">
          <div className="font-semibold text-[13.5px]">Productos sin movimiento</div>
          <span className="font-mono text-[10px] uppercase text-steel bg-cloud rounded-full px-2 py-0.5">Revisión trimestral · Daniel</span>
        </div>
        <div className="flex items-baseline gap-2 mt-2">
          <div className="font-display text-[26px] font-bold">{staleSummary.totalStalePct !== null ? `${staleSummary.totalStalePct.toFixed(1)}%` : "—"}</div>
          <div className="text-[11px] text-steel">del inventario sigue sin venderse</div>
        </div>

        <div className="mt-3">
          <div className="flex items-center justify-between text-[11.5px] mb-1">
            <span className="text-steel">1er trimestre · 3-6 meses</span>
            <span className="font-mono font-semibold" style={{ color: "#e6b04a" }}>{staleSummary.bucket36Pct !== null ? `${staleSummary.bucket36Pct.toFixed(1)}%` : "—"}</span>
          </div>
          <div className="h-1.5 rounded bg-cloud overflow-hidden mb-2.5">
            <div className="h-full" style={{ width: `${staleSummary.bucket36Pct ?? 0}%`, background: "#e6b04a" }} />
          </div>
          <div className="flex items-center justify-between text-[11.5px] mb-1">
            <span className="text-steel">2+ trimestres · +6 meses</span>
            <span className="font-mono font-semibold text-red">{staleSummary.bucket6plusPct !== null ? `${staleSummary.bucket6plusPct.toFixed(1)}%` : "—"}</span>
          </div>
          <div className="h-1.5 rounded bg-cloud overflow-hidden">
            <div className="h-full bg-red" style={{ width: `${staleSummary.bucket6plusPct ?? 0}%` }} />
          </div>
        </div>

        <div className="mt-3 flex flex-col gap-1">
          {data.staleProducts.filter((p) => p.status === "active").slice(0, 5).map((p) => (
            <div key={p.id} className="flex justify-between text-[11.5px] border-t border-rule/50 pt-1.5">
              <span>{p.name} <span className="text-steel">· {staleBucket(p.quartersConfirmed) === "6+" ? "+6 meses" : "3-6 meses"}</span></span>
              <span className="font-mono text-steel">{money(p.value)}</span>
            </div>
          ))}
          {data.staleProducts.filter((p) => p.status === "active").length === 0 && (
            <div className="text-[11.5px] text-steel">Ningún producto marcado todavía.</div>
          )}
        </div>
        <div className="text-[10.5px] text-steel mt-2">Trimestre actual: {quarterLabel(data.currentQuarter)}</div>
      </div>
    </div>
  );
}
