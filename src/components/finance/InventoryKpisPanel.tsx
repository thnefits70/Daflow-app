"use client";

import { useMemo, useState } from "react";
import { TrendingUp, TrendingDown, Minus, ArrowUpDown, Search } from "lucide-react";
import type { InventoryKpisDataDTO } from "@/lib/inventoryKpis";
import type { StaleStreakBucket } from "@/lib/inventoryKpisCalc";
import { TrendSpark } from "@/components/shared/TrendSpark";
import { KpiInfoTip } from "@/components/shared/KpiInfoTip";
import { TabGuide } from "@/components/shared/TabGuide";

const BUCKET_STYLE: Record<StaleStreakBucket, { label: string; color: string }> = {
  "1-3": { label: "recién detectado", color: "#92a3c0" },
  "4-12": { label: "vigilar", color: "#D9A441" },
  "13+": { label: "revisar ya", color: "#e0574a" },
};
const BUCKET_TOOLTIP: Record<StaleStreakBucket, string> = {
  "1-3": "1 a 3 semanas",
  "4-12": "4 a 12 semanas",
  "13+": "13 semanas o más",
};
const RANK_COLORS = ["#e0574a", "#D9A441", "#D9A441"];

const MONTH_NAMES = ["Ene", "Feb", "Mar", "Abr", "May", "Jun", "Jul", "Ago", "Sep", "Oct", "Nov", "Dic"];
function monthLabel(period: string) {
  const [y, m] = period.split("-");
  return `${MONTH_NAMES[Number(m) - 1] ?? m} ${y}`;
}
const MONTH_NAMES_FULL = [
  "Enero", "Febrero", "Marzo", "Abril", "Mayo", "Junio",
  "Julio", "Agosto", "Septiembre", "Octubre", "Noviembre", "Diciembre",
];
// Formatea un período semanal "YYYY-MM-Wn" (staleSnapshotPeriod) sin
// depender de inventoryKpis.ts, que importa Prisma — mismo criterio que
// monthLabel() arriba.
function weekLabel(period: string) {
  const [y, m, w] = period.split("-");
  return `${MONTH_NAMES_FULL[Number(m) - 1] ?? m} ${y} (semana ${w?.replace("W", "") ?? "?"})`;
}
function money(v: number) {
  return "$" + Math.round(v).toLocaleString("es-MX");
}
function unitMoney(v: number) {
  return "$" + v.toLocaleString("es-MX", { minimumFractionDigits: 2, maximumFractionDigits: 3 });
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
    <div className="flex flex-col gap-3.5">
    <TabGuide storageKey="inventoriokpis">
      Estos KPIs se calculan solos a partir de lo que Daniel carga en &quot;Control de Inventario&quot; (el valor total cada mes, el Excel de stock por SKU cada semana). Toca el ícono de información de cada tarjeta para ver cómo se calcula y qué significa el color.
    </TabGuide>
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
        <TrendSpark
          values={data.dioSeries}
          good={data.dio.good}
          detailed
          periods={data.series.map((p) => p.period)}
          valueFormatter={(v) => `${v.toFixed(0)}d`}
        />
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
        <TrendSpark
          values={data.gmroiFullSeries}
          good={data.gmroiSeries.good}
          detailed
          periods={data.series.map((p) => p.period)}
          valueFormatter={(v) => `${v.toFixed(1)}x`}
        />
      </div>

      {/* 4. Productos sin movimiento */}
      <div className="bg-surface border border-rule rounded-md p-4.5" style={{ borderTop: "2px solid #e0574a" }}>
        <div className="flex items-center justify-between mb-1 flex-wrap gap-y-1.5">
          <div className="flex items-center gap-1.5">
            <div className="font-semibold text-[13.5px]">Productos que nadie compra</div>
            <KpiInfoTip>
              <b className="text-ink">Productos cuyo stock no bajó ni un poco desde la semana pasada</b> — si el stock sigue igual (o subió), es porque no se vendió nada de ese producto. Es dinero comprado que está guardado sin convertirse en venta. Ejemplo: si el 15% de tu inventario está aquí, de cada $100 que tienes guardados en productos, $15 llevan semanas sin moverse del estante.
              <br /><br />
              <b className="text-ink">Las flechas de la lista:</b> ↑ roja = el stock siguió subiendo (cada vez peor) · ↓ verde = el stock bajó un poco (empezó a moverse) · — gris = no cambió nada.
            </KpiInfoTip>
          </div>
          <span className="font-mono text-[10px] uppercase text-steel bg-cloud rounded-full px-2 py-0.5">
            {data.staleSnapshotPeriod ? `Corte: ${weekLabel(data.staleSnapshotPeriod)}` : "Sin datos"}
          </span>
        </div>
        <div className="flex items-baseline gap-2 mt-2">
          <div className="font-display text-[26px] font-bold">{staleSummary.totalStalePct !== null ? `${staleSummary.totalStalePct.toFixed(1)}%` : "—"}</div>
          <div className="text-[11px] text-steel">del valor del inventario lleva semanas sin venderse</div>
        </div>
        <div className="text-[11px] text-steel mt-1">
          Mientras más tiempo lleve un producto en esta lista, más urgente es moverlo (rebajarlo, promocionarlo o dejar de comprarlo).
        </div>

        <div className="flex items-center gap-3 mt-3 text-[11px]">
          {(["1-3", "4-12", "13+"] as const).map((b) => {
            const count = b === "1-3" ? staleSummary.bucket1.length : b === "4-12" ? staleSummary.bucket23.length : staleSummary.bucket4plus.length;
            return (
              <div key={b} className="flex items-center gap-1.5" title={`${BUCKET_TOOLTIP[b]} sin venderse`}>
                <span className="w-1.5 h-1.5 rounded-full shrink-0" style={{ background: BUCKET_STYLE[b].color }} />
                <span className="text-steel">{BUCKET_STYLE[b].label}</span>
                <span className="font-mono font-semibold">{count}</span>
              </div>
            );
          })}
        </div>

        <div className="mt-3 flex flex-col max-h-72 overflow-y-auto">
          {data.staleEntries.length > 0 && (
            <div className="sticky top-0 z-10 bg-surface flex items-center gap-2 pb-1.5 mb-1.5 border-b border-rule/50 text-[9.5px] uppercase tracking-wide text-steel/70">
              <span className="w-5 shrink-0" />
              <span className="flex-1 min-w-0">Producto</span>
              <span className="shrink-0 w-[68px] text-center">Sin venderse</span>
              <span className="shrink-0 w-[76px] text-right">Valor guardado</span>
            </div>
          )}
          <div className="flex flex-col gap-1.5">
            {data.staleEntries.slice(0, 8).map((p, i) => (
              <div key={p.productCode} className="flex items-center gap-2 border-t border-rule/50 pt-1.5 text-[11.5px]">
                <span
                  className="w-5 h-5 rounded-full flex items-center justify-center text-[10px] font-bold text-navy shrink-0"
                  style={{ background: i < 3 ? RANK_COLORS[i] : "#24365a", color: i < 3 ? "#0b1f3a" : "#92a3c0" }}
                  title="Puesto en el ranking de más urgente"
                >
                  {i + 1}
                </span>
                <div className="flex-1 min-w-0">
                  <div className="font-semibold truncate">{p.description || p.productCode}</div>
                  <div className="text-steel font-mono text-[10px]">{p.productCode}</div>
                </div>
                <span
                  className="font-mono text-[10px] font-semibold rounded-full px-2 py-0.5 shrink-0 w-[68px] text-center"
                  style={{ background: `${BUCKET_STYLE[p.bucket].color}1f`, color: BUCKET_STYLE[p.bucket].color }}
                  title="Semanas seguidas sin que baje el stock"
                >
                  {p.streakWeeks} {p.streakWeeks === 1 ? "sem" : "sems"}
                </span>
                <span
                  className="font-mono text-steel w-[76px] text-right shrink-0 flex items-center justify-end gap-1"
                  title={
                    (p.trend === "up"
                      ? "El stock siguió subiendo — cada vez peor. "
                      : p.trend === "down"
                        ? "El stock bajó un poco — empezó a moverse. "
                        : "El stock no cambió. ") + "Valor en dólares guardado en este producto."
                  }
                >
                  {p.trend === "up" ? <TrendingUp size={12} className="text-red shrink-0" /> : p.trend === "down" ? <TrendingDown size={12} className="text-teal shrink-0" /> : <Minus size={12} className="text-steel shrink-0" />}
                  {money(p.costTotal)}
                </span>
              </div>
            ))}
            {data.staleEntries.length === 0 && (
              <div className="text-[11.5px] text-steel">
                {data.staleSnapshotPeriod ? "Ningún producto sin movimiento esta semana — todo bajó de stock vs. la semana anterior." : "Todavía no hay un Excel de stock por SKU cargado."}
              </div>
            )}
          </div>
        </div>
      </div>
    </div>

    <AllProductsSnapshotTable rows={data.latestSnapshotRows} period={data.staleSnapshotPeriod} />
    </div>
  );
}

type SnapshotRow = { productCode: string; description: string; avgCost: number; stock: number; costTotal: number };
type SortKey = "stock" | "costTotal" | "critical";

// Confirmado 2026-08-05 (cadencia cambiada a semanal el 2026-08-25): vista
// interina — mientras solo hay UNA semana cargada no hay base para marcar
// "sin movimiento" (KPI #4 sale en 0%), así que esto deja revisar/filtrar
// el inventario real de la semana por stock o valor para actuar de una vez,
// sin esperar la segunda semana de comparación.
function AllProductsSnapshotTable({ rows, period }: { rows: SnapshotRow[]; period: string | null }) {
  const [search, setSearch] = useState("");
  const [sortKey, setSortKey] = useState<SortKey>("critical");
  const [sortDir, setSortDir] = useState<"asc" | "desc">("desc");

  // "Crítico" no es lo mismo que ordenar por valor total: un producto con 1
  // unidad carísima puede ganarle en $ a uno con 500 unidades baratas sin
  // que el segundo sea menos urgente de mover. Por eso se rankea cada
  // producto por separado en stock y en valor, y se combina — así sube arriba
  // el que está alto en AMBAS cosas a la vez, no solo en una.
  const rowsWithRank = useMemo(() => {
    const byStock = [...rows].sort((a, b) => b.stock - a.stock);
    const stockRank = new Map(byStock.map((r, i) => [r.productCode, i]));
    const byValue = [...rows].sort((a, b) => b.costTotal - a.costTotal);
    const valueRank = new Map(byValue.map((r, i) => [r.productCode, i]));
    return rows.map((r) => ({ ...r, criticalScore: (stockRank.get(r.productCode) ?? 0) + (valueRank.get(r.productCode) ?? 0) }));
  }, [rows]);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    const base = q
      ? rowsWithRank.filter((r) => r.productCode.toLowerCase().includes(q) || r.description.toLowerCase().includes(q))
      : rowsWithRank;
    const key = sortKey === "critical" ? "criticalScore" : sortKey;
    // Para "criticalScore" un número MÁS BAJO es más crítico (va arriba en
    // ambos rankings) — se invierte para que "desc" (el default visual de
    // más urgente primero) ordene de menor a mayor puntaje.
    const sorted = [...base].sort((a, b) => {
      const diff = key === "criticalScore" ? a.criticalScore - b.criticalScore : b[key] - a[key];
      return sortDir === "desc" ? diff : -diff;
    });
    return sorted;
  }, [rowsWithRank, search, sortKey, sortDir]);

  function toggleSort(key: SortKey) {
    if (sortKey === key) setSortDir((d) => (d === "asc" ? "desc" : "asc"));
    else { setSortKey(key); setSortDir("desc"); }
  }

  if (rows.length === 0) {
    return (
      <div className="bg-surface border border-rule rounded-md p-4.5">
        <div className="font-semibold text-[13.5px] mb-1">Todos los productos cargados</div>
        <div className="text-[12px] text-steel">Todavía no hay un Excel de stock por SKU cargado.</div>
      </div>
    );
  }

  return (
    <div className="bg-surface border border-rule rounded-md p-4.5">
      <div className="flex items-center justify-between mb-1 flex-wrap gap-y-1.5">
        <div className="font-semibold text-[13.5px]">Todos los productos cargados{period ? ` — ${weekLabel(period)}` : ""}</div>
        <span className="font-mono text-[10px] uppercase text-steel bg-cloud rounded-full px-2 py-0.5">{filtered.length} de {rows.length}</span>
      </div>
      <div className="text-[11px] text-steel mb-3">
        Vista de apoyo mientras se acumula una segunda semana para calcular &quot;sin movimiento&quot; de verdad. &quot;Crítico&quot; combina alto stock + alto valor a la vez, no solo uno de los dos.
      </div>

      <div className="flex items-center gap-2.5 mb-3 flex-wrap">
        <div className="relative flex-1 min-w-40">
          <Search size={13} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-steel" />
          <input
            type="text"
            placeholder="Buscar por código o descripción…"
            className="w-full rounded border border-rule bg-cloud pl-8 pr-2.5 py-1.5 text-[12px]"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
        </div>
        <button
          type="button"
          className={`flex items-center gap-1 rounded border px-2.5 py-1.5 text-[11.5px] font-semibold cursor-pointer whitespace-nowrap ${sortKey === "critical" ? "border-red text-red bg-red/10" : "border-rule text-steel"}`}
          onClick={() => toggleSort("critical")}
        >
          🎯 Crítico {sortKey === "critical" ? (sortDir === "desc" ? "↓" : "↑") : ""}
        </button>
        <button
          type="button"
          className={`flex items-center gap-1 rounded border px-2.5 py-1.5 text-[11.5px] font-semibold cursor-pointer whitespace-nowrap ${sortKey === "stock" ? "border-teal text-teal bg-teal/10" : "border-rule text-steel"}`}
          onClick={() => toggleSort("stock")}
        >
          <ArrowUpDown size={12} /> Stock {sortKey === "stock" ? (sortDir === "desc" ? "↓" : "↑") : ""}
        </button>
        <button
          type="button"
          className={`flex items-center gap-1 rounded border px-2.5 py-1.5 text-[11.5px] font-semibold cursor-pointer whitespace-nowrap ${sortKey === "costTotal" ? "border-teal text-teal bg-teal/10" : "border-rule text-steel"}`}
          onClick={() => toggleSort("costTotal")}
        >
          <ArrowUpDown size={12} /> Valor {sortKey === "costTotal" ? (sortDir === "desc" ? "↓" : "↑") : ""}
        </button>
      </div>

      <div className="overflow-x-auto max-h-[28rem] overflow-y-auto pr-1">
        <table className="w-full min-w-[600px] text-[12px] border-collapse">
          <thead className="sticky top-0 bg-surface">
            <tr>
              <th className="text-left font-mono text-[9.5px] uppercase text-steel pb-1.5 pr-2 whitespace-nowrap">Código</th>
              <th className="text-left font-mono text-[9.5px] uppercase text-steel pb-1.5 pr-2 w-full">Descripción</th>
              <th className="text-right font-mono text-[9.5px] uppercase text-steel pb-1.5 pl-3 whitespace-nowrap">Costo prom.</th>
              <th className="text-right font-mono text-[9.5px] uppercase text-steel pb-1.5 pl-3 whitespace-nowrap">Stock</th>
              <th className="text-right font-mono text-[9.5px] uppercase text-steel pb-1.5 pl-3 whitespace-nowrap">Valor total</th>
            </tr>
          </thead>
          <tbody>
            {filtered.map((r) => (
              <tr key={r.productCode} className="border-t border-rule/50">
                <td className="py-1.5 pr-2 font-mono text-steel whitespace-nowrap">{r.productCode}</td>
                <td className="py-1.5 pr-2 font-semibold truncate max-w-64">{r.description}</td>
                <td className="py-1.5 pl-3 text-right font-mono whitespace-nowrap">{unitMoney(r.avgCost)}</td>
                <td className="py-1.5 pl-3 text-right font-mono whitespace-nowrap">{r.stock.toLocaleString("es-MX")}</td>
                <td className="py-1.5 pl-3 text-right font-mono whitespace-nowrap">{money(r.costTotal)}</td>
              </tr>
            ))}
          </tbody>
        </table>
        {filtered.length === 0 && <div className="text-[12px] text-steel py-4 text-center">Ningún producto coincide con la búsqueda.</div>}
      </div>
    </div>
  );
}
