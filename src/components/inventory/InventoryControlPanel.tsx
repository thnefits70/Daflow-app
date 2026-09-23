"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { CheckCircle2, Upload, AlertTriangle, TrendingDown, Minus, PlayCircle } from "lucide-react";
import type { InventoryControlPeriodDTO, InventorySnapshotPeriodDTO } from "@/lib/inventoryKpis";
import { uploadFile } from "@/lib/uploadFile";
import { TabGuide } from "@/components/shared/TabGuide";
import { ExpandableName } from "@/components/ui/ExpandableName";

const MONTH_NAMES = ["Ene", "Feb", "Mar", "Abr", "May", "Jun", "Jul", "Ago", "Sep", "Oct", "Nov", "Dic"];
function monthLabel(period: string) {
  const [y, m] = period.split("-");
  return `${MONTH_NAMES[Number(m) - 1] ?? m} ${y}`;
}
const MONTH_NAMES_FULL = [
  "Enero", "Febrero", "Marzo", "Abril", "Mayo", "Junio",
  "Julio", "Agosto", "Septiembre", "Octubre", "Noviembre", "Diciembre",
];
// Formatea un período semanal "YYYY-MM-Wn" sin depender de inventoryKpis.ts
// (ese módulo importa Prisma, no se puede traer a un componente cliente) —
// mismo criterio que monthLabel() arriba, que ya duplica este formateo
// localmente en vez de importarlo del server.
function weekLabel(period: string) {
  const [y, m, w] = period.split("-");
  return `${MONTH_NAMES_FULL[Number(m) - 1] ?? m} ${y} (semana ${w?.replace("W", "") ?? "?"})`;
}
function money(v: number) {
  return "$" + v.toLocaleString("es-MX", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

type SnapshotPreviewRow = {
  productCode: string;
  description: string;
  avgCost: number;
  stock: number;
  costTotal: number;
  previousStock: number | null;
  decreased: boolean | null;
};
type SnapshotPreview = { period: string; previousPeriod: string | null; rows: SnapshotPreviewRow[] };

export function InventoryControlPanel({
  currentPeriodDefault,
  periods,
  currentSnapshotPeriodDefault,
  snapshotPeriods,
}: {
  currentPeriodDefault: string;
  periods: InventoryControlPeriodDTO[];
  currentSnapshotPeriodDefault: string;
  snapshotPeriods: InventorySnapshotPeriodDTO[];
}) {
  const router = useRouter();
  const [period, setPeriod] = useState(currentPeriodDefault);
  const selectedData = periods.find((p) => p.period === period) ?? null;

  // --- Sección 2: Excel semanal de stock por SKU ("Productos sin movimiento") ---
  const [snapPeriod, setSnapPeriod] = useState(currentSnapshotPeriodDefault);
  const snapData = snapshotPeriods.find((p) => p.period === snapPeriod) ?? null;
  const [snapPhase, setSnapPhase] = useState<"idle" | "processing" | "preview">("idle");
  const [snapPreview, setSnapPreview] = useState<SnapshotPreview | null>(null);
  const [snapWarnings, setSnapWarnings] = useState<string[]>([]);
  const [snapErr, setSnapErr] = useState("");
  const [snapBusy, setSnapBusy] = useState(false);
  const [snapToast, setSnapToast] = useState("");
  const [snapDragOver, setSnapDragOver] = useState(false);
  // Fase 3 (INVESTOCK) — confirmado 2026-09-09: comparación calculada sola
  // al guardar, contra el número propio de DAFLOW — ordenada por la
  // diferencia más grande primero. Extendida 2026-09-16 con el costo
  // promedio (antes solo comparaba stock) — mismo criterio, nunca
  // sobrescribe el costo real de INVESTOCK, solo referencia.
  const [comparison, setComparison] = useState<
    {
      catalogItemId: string;
      productName: string;
      productCode: string;
      justStock: number;
      investockStock: number;
      difference: number;
      justAvgCost: number;
      investockAvgCost: number;
      avgCostDifference: number;
    }[]
  >([]);
  // Confirmado 2026-09-10 (pedido explícito del usuario): "cargar saldo
  // inicial de INVESTOCK" — solo aparece si de verdad hay algo pendiente de
  // cargar (productos que siguen en 0). savedRows se guarda para poder
  // sembrar sin volver a pedirle el archivo a Daniel.
  const [seedableCount, setSeedableCount] = useState(0);
  const [savedRows, setSavedRows] = useState<{ productCode: string; avgCost: number; stock: number }[]>([]);
  const [seeding, setSeeding] = useState(false);
  const [seedResult, setSeedResult] = useState("");

  function resetSnapUpload() {
    setSnapPhase("idle");
    setSnapPreview(null);
    setSnapWarnings([]);
    setSnapErr("");
  }

  function changeSnapPeriod(newPeriod: string) {
    setSnapPeriod(newPeriod);
    resetSnapUpload();
    setSnapToast("");
  }

  // Confirmado 2026-09-16, pedido explícito del usuario: la comparación
  // contra INVESTOCK antes solo se veía justo al subir un archivo nuevo —
  // ahora, al elegir una semana que ya tiene datos cargados, se vuelve a
  // consultar sola (sin tener que resubir el archivo). Sin setState
  // síncrono en el cuerpo (ver feedback_effect_setstate_pattern) — si la
  // semana elegida no tiene snapshot, simplemente no busca nada; el render
  // de abajo ya exige snapData?.hasSnapshot, así que datos viejos de otra
  // semana no se llegan a mostrar aunque comparison no se limpie acá.
  function loadComparison() {
    if (!snapData?.hasSnapshot) return;
    fetch(`/api/inventory-control/stock-comparison?period=${snapPeriod}`)
      .then((r) => (r.ok ? r.json() : []))
      .then(setComparison)
      .catch(() => setComparison([]));
  }
  useEffect(loadComparison, [snapPeriod, snapData?.hasSnapshot]);

  async function handleSnapFile(file: File) {
    setSnapErr("");
    setSnapToast("");
    setSnapPhase("processing");

    const uploaded = await uploadFile(file, "inventory-stock-snapshot");
    if (!uploaded.ok) {
      setSnapErr(uploaded.error);
      setSnapPhase("idle");
      return;
    }

    const res = await fetch("/api/inventory-control/stock-snapshot/parse", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ period: snapPeriod, fileUrl: uploaded.url, fileName: uploaded.name }),
    });
    const json = await res.json().catch(() => null);
    if (!res.ok) {
      setSnapErr(json?.error ?? "No se pudo leer el archivo.");
      setSnapPhase("idle");
      return;
    }
    setSnapPreview(json.preview);
    setSnapWarnings(json.warnings ?? []);
    setSnapPhase("preview");
  }

  async function confirmSnapSave() {
    if (!snapPreview) return;
    setSnapBusy(true);
    setSnapErr("");
    const res = await fetch("/api/inventory-control/stock-snapshot/save", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        period: snapPreview.period,
        rows: snapPreview.rows.map((r) => ({
          productCode: r.productCode, description: r.description, avgCost: r.avgCost, stock: r.stock, costTotal: r.costTotal,
        })),
      }),
    });
    setSnapBusy(false);
    const json = await res.json().catch(() => null);
    if (!res.ok) { setSnapErr(json?.error ?? "No se pudo guardar."); return; }
    setComparison(json.comparison ?? []);
    setSeedableCount(json.seedableCount ?? 0);
    setSavedRows(snapPreview.rows.map((r) => ({ productCode: r.productCode, avgCost: r.avgCost, stock: r.stock })));
    setSeedResult("");
    resetSnapUpload();
    setSnapToast(`✅ ${weekLabel(snapPreview.period)} guardado — ${json.count} productos. Los KPIs ya se actualizaron.`);
    router.refresh();
  }

  async function seedInvestock() {
    setSeeding(true);
    setSeedResult("");
    const res = await fetch("/api/inventory-control/stock-snapshot/seed-investock", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ rows: savedRows }),
    });
    setSeeding(false);
    const json = await res.json().catch(() => null);
    if (!res.ok) { setSeedResult(json?.error ?? "No se pudo cargar el saldo inicial."); return; }
    setSeedableCount(0);
    setSeedResult(`✅ ${json.seededCount} producto(s) cargado(s) con su saldo inicial de INVESTOCK.`);
  }

  return (
    <div className="flex flex-col gap-4.5">
      <TabGuide storageKey="control-inventario">
        Sube acá cada semana tu reporte de saldos costeados y valorizados (Excel) para el ranking de productos sin movimiento. El valor de inventario del mes ya no se sube — se calcula solo desde INVESTOCK.
      </TabGuide>
      <div className="bg-surface border border-rule rounded-md p-4.5">
        <div className="flex items-center justify-between mb-1">
          <div className="font-semibold text-[13.5px]">Valor de inventario del mes</div>
          <span className="font-mono text-[10px] uppercase text-steel bg-cloud rounded-full px-2 py-0.5">Automático</span>
        </div>
        <div className="text-[11.5px] text-steel mb-3">
          Ya no hace falta escribirlo ni adjuntar captura — se calcula solo desde INVESTOCK (stock real × costo promedio real de cada producto, al cierre de ese mes).
        </div>

        <div className="mb-3">
          <label className="block mb-1 text-[10px] uppercase tracking-wide text-steel">Mes</label>
          <select
            className="rounded border border-rule bg-cloud px-2.5 py-2 text-[13px] font-mono"
            value={period}
            onChange={(e) => setPeriod(e.target.value)}
          >
            {periods.map((p) => (
              <option key={p.period} value={p.period}>
                {monthLabel(p.period)}{p.value !== null ? " · calculado" : ""}{p.period === currentPeriodDefault ? " (actual)" : ""}
              </option>
            ))}
          </select>
        </div>

        {selectedData?.value !== null && selectedData?.value !== undefined ? (
          <div>
            <div className="font-display text-[22px] font-bold mb-1.5">{money(selectedData.value)}</div>
            {selectedData.source === "auto" ? (
              <div className="text-[11.5px] text-steel">Calculado en tiempo real desde INVESTOCK.</div>
            ) : (
              <div className="text-[11.5px] text-steel">Valor histórico cargado a mano antes de automatizar este cálculo.</div>
            )}
          </div>
        ) : (
          <div className="flex items-center gap-2 text-[11.5px] text-steel">
            <AlertTriangle size={13} /> Pendiente — sube el reporte semanal de {monthLabel(period)} para calcularlo solo.
          </div>
        )}
      </div>

      <div className="bg-surface border border-rule rounded-md p-4.5">
        <div className="flex items-center justify-between mb-1">
          <div className="font-semibold text-[13.5px]">Productos sin movimiento — stock por SKU</div>
          <span className="font-mono text-[10px] uppercase text-steel bg-cloud rounded-full px-2 py-0.5">Cada semana</span>
        </div>
        <div className="text-[11.5px] text-steel mb-3">
          Sube el mismo reporte de saldos costeados y valorizados (código, costo promedio, descripción, stock actual). DAFLOW compara cada producto contra la semana anterior y arma el ranking de productos sin movimiento solo — ya no hace falta escribirlos a mano.
        </div>

        {snapErr && <div className="text-red text-[12.5px] mb-2.5">{snapErr}</div>}

        {snapPhase !== "preview" && (
          <div className="mb-3">
            <label className="block mb-1 text-[10px] uppercase tracking-wide text-steel">Semana del reporte</label>
            <select
              className="rounded border border-rule bg-cloud px-2.5 py-2 text-[13px] font-mono"
              value={snapPeriod}
              onChange={(e) => changeSnapPeriod(e.target.value)}
            >
              {snapshotPeriods.map((p) => (
                <option key={p.period} value={p.period}>
                  {p.label}{p.hasSnapshot ? " · ya cargado" : ""}{p.period === currentSnapshotPeriodDefault ? " (actual)" : ""}
                </option>
              ))}
            </select>
            {snapData && !snapData.hasSnapshot && (
              <div className={`mt-1.5 text-[11px] ${snapData.overdue ? "text-red" : "text-steel"}`}>
                {snapData.overdue ? "⚠️ Atrasado — " : "Fecha límite: "}vence {snapData.deadlineLabel}
              </div>
            )}
          </div>
        )}

        {snapPhase !== "preview" && snapData?.hasSnapshot && (
          <div className="bg-gold/10 border border-gold/30 rounded-md p-3 mb-3.5 text-[12.5px]" style={{ color: "#D9A441" }}>
            <div className="flex items-center gap-1.5 font-semibold">
              <AlertTriangle size={14} /> Ya existe un reporte cargado para {snapData.label}.
            </div>
            <div className="text-steel mt-1">Si subes uno nuevo, se <b className="text-ink">reemplaza por completo</b> la semana — útil si detectaste un error.</div>
          </div>
        )}

        {snapPhase === "idle" && (
          <label
            className={`flex flex-col items-center justify-center gap-1.5 border-[1.5px] border-dashed rounded-md py-7 cursor-pointer transition-colors ${
              snapDragOver ? "border-teal bg-teal/5" : "border-rule hover:border-teal"
            }`}
            onDragOver={(e) => {
              e.preventDefault();
              setSnapDragOver(true);
            }}
            onDragLeave={(e) => {
              e.preventDefault();
              setSnapDragOver(false);
            }}
            onDrop={(e) => {
              e.preventDefault();
              setSnapDragOver(false);
              const file = e.dataTransfer.files?.[0];
              if (file) handleSnapFile(file);
            }}
          >
            <Upload size={22} className="text-steel" />
            <div className="text-[13px] font-semibold">Arrastra tu reporte aquí o haz clic para elegirlo</div>
            <div className="text-[11px] text-steel">Formato .xlsx o .xls — código, costo promedio, descripción, stock actual</div>
            <input
              type="file"
              accept=".xlsx,.xls"
              className="hidden"
              onChange={(e) => e.target.files?.[0] && handleSnapFile(e.target.files[0])}
            />
          </label>
        )}

        {snapPhase === "processing" && (
          <div className="flex items-center justify-center gap-2.5 py-7 text-steel text-[13px]">
            <span className="w-4 h-4 rounded-full border-2 border-rule border-t-teal animate-spin" /> Leyendo reporte…
          </div>
        )}

        {snapPhase === "preview" && snapPreview && (
          <div>
            <div className="text-[11.5px] text-steel mb-2.5">
              {snapPreview.previousPeriod
                ? <>Comparando contra <b className="text-ink">{weekLabel(snapPreview.previousPeriod)}</b> (la semana anterior con datos cargados).</>
                : <>No hay una semana anterior cargada todavía — este será el primer punto de comparación, ningún producto se marcará sin movimiento aún.</>}
            </div>
            <div className="overflow-x-auto mb-3 max-h-96">
              <table className="w-full text-[12px] border-collapse">
                <thead className="sticky top-0 bg-surface">
                  <tr>
                    <th className="text-left font-mono text-[9.5px] uppercase text-steel pb-1.5">Código</th>
                    <th className="text-left font-mono text-[9.5px] uppercase text-steel pb-1.5">Descripción</th>
                    <th className="text-right font-mono text-[9.5px] uppercase text-steel pb-1.5">Costo prom.</th>
                    <th className="text-right font-mono text-[9.5px] uppercase text-steel pb-1.5">Stock actual</th>
                    <th className="text-right font-mono text-[9.5px] uppercase text-steel pb-1.5">Stock anterior</th>
                    <th className="text-center font-mono text-[9.5px] uppercase text-steel pb-1.5">¿Bajó?</th>
                  </tr>
                </thead>
                <tbody>
                  {snapPreview.rows.map((r) => (
                    <tr key={r.productCode} className="border-t border-rule/50">
                      <td className="py-1.5 font-mono text-steel">{r.productCode}</td>
                      <td className="py-1.5 font-semibold max-w-56"><ExpandableName text={r.description} /></td>
                      <td className="py-1.5 text-right font-mono">{money(r.avgCost)}</td>
                      <td className="py-1.5 text-right font-mono">{r.stock}</td>
                      <td className="py-1.5 text-right font-mono text-steel">{r.previousStock !== null ? r.previousStock : "—"}</td>
                      <td className="py-1.5 text-center">
                        {r.decreased === null ? (
                          <span className="text-steel">—</span>
                        ) : r.decreased ? (
                          <span className="inline-flex items-center gap-1 text-teal"><TrendingDown size={12} /> sí</span>
                        ) : (
                          <span className="inline-flex items-center gap-1 text-red"><Minus size={12} /> no</span>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            {snapWarnings.length > 0 && (
              <div className="flex flex-col gap-1 mb-3">
                {snapWarnings.map((w, i) => (
                  <div key={i} className="text-[11.5px] flex items-start gap-1.5" style={{ color: "#D9A441" }}>
                    <AlertTriangle size={13} className="mt-0.5 shrink-0" /> {w}
                  </div>
                ))}
              </div>
            )}
            <div className="flex items-center gap-2.5">
              <button
                type="button" disabled={snapBusy}
                className="rounded border border-teal bg-teal px-4 py-2 text-[13px] font-semibold text-navy cursor-pointer disabled:opacity-60"
                onClick={confirmSnapSave}
              >
                {snapData?.hasSnapshot ? "Reemplazar" : "Confirmar y guardar"} {weekLabel(snapPreview.period)}
              </button>
              <button type="button" className="text-steel text-[13px] cursor-pointer" onClick={resetSnapUpload}>
                Cancelar
              </button>
            </div>
          </div>
        )}

        {snapToast && snapPhase === "idle" && (
          <div className="mt-3 flex items-center gap-2 text-teal text-[12.5px] bg-teal/10 border border-teal/30 rounded-md px-3 py-2">
            <CheckCircle2 size={14} /> {snapToast}
          </div>
        )}

        {seedableCount > 0 && snapPhase === "idle" && (
          <div className="mt-3 bg-yellow/10 border border-yellow/35 rounded-md p-3">
            <div className="text-[12.5px] text-ink mb-2">
              {seedableCount} producto(s) de este archivo todavía no tienen ningún movimiento propio en INVESTOCK — puedes cargarles su stock y costo promedio real como punto de partida.
            </div>
            <button
              type="button"
              disabled={seeding}
              className="flex items-center gap-1.5 rounded border border-teal bg-teal px-3.5 py-2 text-[12.5px] font-bold text-navy cursor-pointer disabled:opacity-60"
              onClick={seedInvestock}
            >
              <PlayCircle size={14} /> {seeding ? "Cargando…" : `Cargar saldo inicial de INVESTOCK (${seedableCount} productos pendientes)`}
            </button>
          </div>
        )}
        {seedResult && snapPhase === "idle" && (
          <div className="mt-3 text-teal text-[12.5px] bg-teal/10 border border-teal/30 rounded-md px-3 py-2">{seedResult}</div>
        )}

        {snapData?.hasSnapshot && comparison.length > 0 && snapPhase === "idle" && (
          <div className="mt-4">
            <div className="text-[12px] font-semibold text-steel mb-2">
              Comparación contra INVESTOCK — {comparison.filter((c) => c.difference !== 0).length} de {comparison.length} con stock distinto, {comparison.filter((c) => Math.abs(c.avgCostDifference) > 0.005).length} con costo promedio distinto
            </div>
            <div className="text-[10.5px] text-steel-dim mb-2">
              Solo de referencia — nunca cambia el número real de INVESTOCK. Sirve para que Daniel revise, producto por producto, si la diferencia es un error propio (falta registrar un movimiento) o si Just está desactualizado.
            </div>
            <div className="max-h-72 overflow-y-auto rounded-md border border-rule">
              <table className="w-full text-[12px]">
                <thead className="sticky top-0 bg-cloud">
                  <tr>
                    <th rowSpan={2} className="text-left px-2.5 py-1.5 font-semibold text-steel align-bottom">Producto</th>
                    <th colSpan={3} className="text-center px-2.5 py-1 font-semibold text-steel border-b border-rule">Stock</th>
                    <th colSpan={3} className="text-center px-2.5 py-1 font-semibold text-steel border-b border-rule border-l border-rule">Costo promedio</th>
                  </tr>
                  <tr>
                    <th className="text-right px-2.5 py-1.5 font-semibold text-steel">Just</th>
                    <th className="text-right px-2.5 py-1.5 font-semibold text-steel">INVESTOCK</th>
                    <th className="text-right px-2.5 py-1.5 font-semibold text-steel">Dif.</th>
                    <th className="text-right px-2.5 py-1.5 font-semibold text-steel border-l border-rule">Just</th>
                    <th className="text-right px-2.5 py-1.5 font-semibold text-steel">INVESTOCK</th>
                    <th className="text-right px-2.5 py-1.5 font-semibold text-steel">Dif.</th>
                  </tr>
                </thead>
                <tbody>
                  {comparison.map((c) => (
                    <tr key={c.catalogItemId} className="border-t border-rule">
                      <td className="px-2.5 py-1.5">{c.productName}</td>
                      <td className="px-2.5 py-1.5 text-right tabular-nums">{c.justStock}</td>
                      <td className="px-2.5 py-1.5 text-right tabular-nums">{c.investockStock}</td>
                      <td className={`px-2.5 py-1.5 text-right tabular-nums font-semibold ${c.difference === 0 ? "text-steel" : "text-red"}`}>
                        {c.difference > 0 ? "+" : ""}{c.difference}
                      </td>
                      <td className="px-2.5 py-1.5 text-right tabular-nums border-l border-rule">{money(c.justAvgCost)}</td>
                      <td className="px-2.5 py-1.5 text-right tabular-nums">{money(c.investockAvgCost)}</td>
                      <td className={`px-2.5 py-1.5 text-right tabular-nums font-semibold ${Math.abs(c.avgCostDifference) <= 0.005 ? "text-steel" : "text-red"}`}>
                        {c.avgCostDifference > 0 ? "+" : c.avgCostDifference < 0 ? "-" : ""}{money(Math.abs(c.avgCostDifference))}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
