import { TrendSpark } from "@/components/shared/TrendSpark";
import { KpiInfoTip } from "@/components/shared/KpiInfoTip";
import type { InventoryKpisDataDTO } from "@/lib/inventoryKpis";

// Tarjeta compacta en Inicio — confirmado 2026-08-04: visible para el líder
// de Inventario (Daniel, aunque él nunca la vea desde su propia pantalla de
// captura), el líder de Análisis de Mercado/ventas (Bryan Ríos), el líder de
// Finanzas (Nairoby) y el dueño. Mismo cálculo que la pestaña "Inventario" de
// KPIs financieros, solo que resumido.
export function InventoryKpisHomeCard({ data }: { data: InventoryKpisDataDTO }) {
  if (!data.hasData) return null;

  return (
    <div className="bg-surface border border-rule rounded-md p-4.5">
      <div className="font-semibold text-[13.5px] mb-3">📦 KPIs de inventario</div>
      <div className="grid grid-cols-3 gap-3">
        <div>
          <div className="flex items-center gap-1 flex-wrap mb-1">
            <span className="text-[9.5px] uppercase tracking-wide text-steel">Rotación (DIO)</span>
            <KpiInfoTip>
              <b className="text-ink">Días de inventario:</b> cuántos días te tomaría vender todo lo que tienes guardado, al ritmo actual. Ejemplo: $10,000 en productos y $5,000/mes de costo vendido = 2 meses para vender lo de hoy. Más bajo es mejor.
            </KpiInfoTip>
          </div>
          <div className="font-display text-[19px] font-bold">{data.dio.current !== null ? `${data.dio.current.toFixed(0)}d` : "—"}</div>
          <TrendSpark values={data.dioSeries} good={data.dio.good} height={28} />
        </div>
        <div>
          <div className="flex items-center gap-1 flex-wrap mb-1">
            <span className="text-[9.5px] uppercase tracking-wide text-steel">GMROI</span>
            <KpiInfoTip>
              <b className="text-ink">Ganancia bruta por cada $1 invertido en inventario.</b> Ejemplo: 0.5x = solo $0.50 de ganancia por cada $1 guardado (menos de lo invertido); 2x = $2 de ganancia por cada $1 — mucho mejor.
            </KpiInfoTip>
          </div>
          <div className="font-display text-[19px] font-bold">{data.gmroiSeries.current !== null ? `${data.gmroiSeries.current.toFixed(1)}x` : "—"}</div>
          <TrendSpark values={data.gmroiFullSeries} good={data.gmroiSeries.good} height={28} />
        </div>
        <div>
          <div className="flex items-center gap-1 flex-wrap mb-1">
            <span className="text-[9.5px] uppercase tracking-wide text-steel">Sin movimiento</span>
            <KpiInfoTip>
              <b className="text-ink">% del inventario que lleva tiempo sin venderse.</b> Ejemplo: 15% significa que de cada $100 guardados, $15 son productos que nadie compra — dinero que podría generar ventas en otro producto.
            </KpiInfoTip>
          </div>
          <div className="font-display text-[19px] font-bold" style={{ color: (data.staleSummary.totalStalePct ?? 0) > 15 ? "#e0574a" : undefined }}>
            {data.staleSummary.totalStalePct !== null ? `${data.staleSummary.totalStalePct.toFixed(1)}%` : "—"}
          </div>
          <div className="text-[9.5px] text-steel mt-1">del valor de inventario</div>
        </div>
      </div>
      {data.overstockAlert.alert && (
        <div className="mt-3 flex items-center gap-2 text-[11.5px] bg-red/10 border border-red/30 text-red rounded-md px-3 py-1.5">
          <span className="w-1.5 h-1.5 rounded-full bg-red shrink-0" /> {data.overstockAlert.message}
        </div>
      )}
    </div>
  );
}
