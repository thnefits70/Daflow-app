"use client";

import { TrendingUp, TrendingDown, Minus } from "lucide-react";
import type { InventoryKpisDataDTO } from "@/lib/inventoryKpis";
import type { StaleStreakBucket } from "@/lib/inventoryKpisCalc";
import { TrendSpark } from "@/components/shared/TrendSpark";
import { KpiInfoTip } from "@/components/shared/KpiInfoTip";

const BUCKET_STYLE: Record<StaleStreakBucket, { label: string; color: string }> = {
  "1": { label: "recién detectado", color: "#92a3c0" },
  "2-3": { label: "vigilar", color: "#D9A441" },
  "4+": { label: "revisar ya", color: "#e0574a" },
};
const RANK_COLORS = ["#e0574a", "#D9A441", "#D9A441"];

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
        <div className="flex items-center justify-between mb-1 flex-wrap gap-y-1.5">
          <div className="flex items-center gap-1.5">
            <div className="font-semibold text-[13.5px]">Rotación de inventario (DIO)</div>
            <KpiInfoTip>
              <b className="text-ink">Días de inventario:</b> cuántos días te tomaría vender todo lo que tienes guardado, al ritmo actual. Ejemplo: si tienes $10,000 en productos y cada mes vendes $5,000 en costo, tardarías 2 meses (≈60 días) en vender lo que hay hoy. Mientras más bajo, mejor — el dinero no se queda &quot;dormido&quot; en la bodega.
            </KpiInfoTip>
          </div>
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
        <div className="flex items-center justify-between mb-1 flex-wrap gap-y-1.5">
          <div className="flex items-center gap-1.5">
            <div className="font-semibold text-[13.5px]">Inventario vs. Ventas (mensual)</div>
            <KpiInfoTip>
              <b className="text-ink">Compara si lo guardado crece al mismo ritmo que lo vendido.</b> Ejemplo: si tu inventario subió de $40,000 a $50,000 pero las ventas del mes se quedaron igual, es señal de que se está comprando más de lo que el negocio realmente está absorbiendo — mercadería que se puede acumular sin venderse.
            </KpiInfoTip>
          </div>
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
        <div className="flex items-center justify-between mb-1 flex-wrap gap-y-1.5">
          <div className="flex items-center gap-1.5">
            <div className="font-semibold text-[13.5px]">GMROI</div>
            <KpiInfoTip>
              <b className="text-ink">Por cada $1 invertido en inventario, cuánta ganancia bruta genera.</b> Ejemplo: un GMROI de 0.5x significa que por cada $1 en inventario, solo se generan $0.50 de ganancia — menos de lo invertido. Un GMROI de 2x significa $2 de ganancia por cada $1 invertido — mucho mejor.
            </KpiInfoTip>
          </div>
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
        <div className="flex items-center justify-between mb-1 flex-wrap gap-y-1.5">
          <div className="flex items-center gap-1.5">
            <div className="font-semibold text-[13.5px]">Productos sin movimiento</div>
            <KpiInfoTip>
              <b className="text-ink">% del valor de inventario que lleva meses sin bajar de stock</b> — el mejor proxy que tenemos sin ventas por SKU: si el stock no bajó vs. el mes anterior, no hay evidencia de que se haya vendido. Ejemplo: si el 15% de tu inventario está &quot;sin movimiento&quot;, de cada $100 guardados, $15 son productos que nadie parece estar comprando.
            </KpiInfoTip>
          </div>
          <span className="font-mono text-[10px] uppercase text-steel bg-cloud rounded-full px-2 py-0.5">
            {data.staleSnapshotPeriod ? `Excel · ${monthLabel(data.staleSnapshotPeriod)}` : "Sin datos"}
          </span>
        </div>
        <div className="flex items-baseline gap-2 mt-2">
          <div className="font-display text-[26px] font-bold">{staleSummary.totalStalePct !== null ? `${staleSummary.totalStalePct.toFixed(1)}%` : "—"}</div>
          <div className="text-[11px] text-steel">del valor de inventario en riesgo</div>
        </div>

        <div className="flex items-center gap-3 mt-3 text-[11px]">
          {(["1", "2-3", "4+"] as const).map((b) => {
            const count = b === "1" ? staleSummary.bucket1.length : b === "2-3" ? staleSummary.bucket23.length : staleSummary.bucket4plus.length;
            return (
              <div key={b} className="flex items-center gap-1.5">
                <span className="w-1.5 h-1.5 rounded-full shrink-0" style={{ background: BUCKET_STYLE[b].color }} />
                <span className="text-steel">{BUCKET_STYLE[b].label}</span>
                <span className="font-mono font-semibold">{count}</span>
              </div>
            );
          })}
        </div>

        <div className="mt-3 flex flex-col gap-1.5 max-h-72 overflow-y-auto">
          {data.staleEntries.slice(0, 8).map((p, i) => (
            <div key={p.productCode} className="flex items-center gap-2.5 border-t border-rule/50 pt-1.5 text-[11.5px]">
              <span
                className="w-5 h-5 rounded-full flex items-center justify-center text-[10px] font-bold text-navy shrink-0"
                style={{ background: i < 3 ? RANK_COLORS[i] : "#24365a", color: i < 3 ? "#0b1f3a" : "#92a3c0" }}
              >
                {i + 1}
              </span>
              <div className="flex-1 min-w-0">
                <div className="font-semibold truncate">{p.description || p.productCode}</div>
                <div className="text-steel font-mono text-[10px]">{p.productCode}</div>
              </div>
              <span
                className="font-mono text-[10px] font-semibold rounded-full px-2 py-0.5 shrink-0"
                style={{ background: `${BUCKET_STYLE[p.bucket].color}1f`, color: BUCKET_STYLE[p.bucket].color }}
              >
                {p.streakMonths} {p.streakMonths === 1 ? "mes" : "meses"}
              </span>
              <span className="font-mono text-steel w-20 text-right shrink-0">{money(p.costTotal)}</span>
              <span className="shrink-0">
                {p.trend === "up" ? <TrendingUp size={13} className="text-red" /> : p.trend === "down" ? <TrendingDown size={13} className="text-teal" /> : <Minus size={13} className="text-steel" />}
              </span>
            </div>
          ))}
          {data.staleEntries.length === 0 && (
            <div className="text-[11.5px] text-steel">
              {data.staleSnapshotPeriod ? "Ningún producto sin movimiento este mes — todo bajó de stock vs. el mes anterior." : "Todavía no hay un Excel de stock por SKU cargado."}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
