"use client";

import { useEffect, useState } from "react";
import { Upload, AlertTriangle, CheckCircle2 } from "lucide-react";
import { uploadFile } from "@/lib/uploadFile";

const MONTH_NAMES_FULL = [
  "Enero", "Febrero", "Marzo", "Abril", "Mayo", "Junio",
  "Julio", "Agosto", "Septiembre", "Octubre", "Noviembre", "Diciembre",
];

function monthLabel(period: string) {
  const [y, m] = period.split("-");
  return `${MONTH_NAMES_FULL[Number(m) - 1] ?? m} ${y}`;
}

function currentMonth() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
}

function recentMonths(): string[] {
  const out: string[] = [];
  const d = new Date();
  for (let i = 0; i < 6; i++) {
    const m = new Date(d.getFullYear(), d.getMonth() - i, 1);
    out.push(`${m.getFullYear()}-${String(m.getMonth() + 1).padStart(2, "0")}`);
  }
  return out;
}

type PreviewRow = { catalogItemId: string; catalogItemName: string; unitsMoved: number };
type Preview = { month: string; rows: PreviewRow[] };
type Entry = { month: string; unitsMoved: number; catalogItem: { id: string; name: string; justCode: string | null } };

// Confirmado 2026-09-04: pedido explícito de Daniel — sube una vez al mes el
// reporte de productos con más movimiento (200+ unidades), y esos ganadores
// se suman a los de ATOM para el cruce de Sugerencias de Combos. Ideal
// subirlo en los primeros 3 días del mes (para tener el dato fresco cuanto
// antes), pero se puede subir después con solo un aviso — nunca bloqueado
// (confirmado con el usuario).
export function MonthlyTopMoversPanel() {
  const [month, setMonth] = useState(currentMonth());
  const [entries, setEntries] = useState<Entry[] | null>(null);
  const [phase, setPhase] = useState<"idle" | "processing" | "preview">("idle");
  const [dragOver, setDragOver] = useState(false);
  const [preview, setPreview] = useState<Preview | null>(null);
  const [warnings, setWarnings] = useState<string[]>([]);
  const [err, setErr] = useState("");
  const [busy, setBusy] = useState(false);
  const [toast, setToast] = useState("");

  function load() {
    fetch("/api/inventory-control/monthly-top-movers")
      .then((r) => (r.ok ? r.json() : null))
      .then((data) => setEntries(data?.entries ?? []))
      .catch(() => setEntries([]));
  }
  useEffect(load, []);

  const monthsWithData = new Set((entries ?? []).map((e) => e.month));
  const alreadyLoaded = monthsWithData.has(month);
  const dayOfMonth = new Date().getDate();
  const withinWindow = dayOfMonth <= 3;

  async function handleFile(file: File) {
    setErr("");
    setPhase("processing");
    const uploaded = await uploadFile(file, "monthly-top-movers");
    if (!uploaded.ok) {
      setErr(uploaded.error);
      setPhase("idle");
      return;
    }
    const res = await fetch("/api/inventory-control/monthly-top-movers/parse", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ month, fileUrl: uploaded.url, fileName: uploaded.name }),
    });
    const data = await res.json().catch(() => null);
    if (!res.ok) {
      setErr(data?.error ?? "No se pudo leer el archivo.");
      setPhase("idle");
      return;
    }
    setPreview(data.preview);
    setWarnings(data.warnings ?? []);
    setPhase("preview");
  }

  async function confirmSave() {
    if (!preview) return;
    setBusy(true);
    setErr("");
    const res = await fetch("/api/inventory-control/monthly-top-movers", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ month: preview.month, rows: preview.rows.map((r) => ({ catalogItemId: r.catalogItemId, unitsMoved: r.unitsMoved })) }),
    });
    const data = await res.json().catch(() => null);
    setBusy(false);
    if (!res.ok) {
      setErr(data?.error ?? "No se pudo guardar.");
      return;
    }
    setToast(`Guardado — ${data.savedCount} productos ganadores de ${monthLabel(preview.month)}.`);
    reset();
    load();
  }

  function reset() {
    setPhase("idle");
    setPreview(null);
    setWarnings([]);
  }

  return (
    <div className="bg-surface border border-rule rounded-md p-4.5">
      <div className="flex items-center justify-between mb-1">
        <div className="font-semibold text-[13.5px]">Productos ganadores del mes</div>
        <span className="font-mono text-[10px] uppercase text-steel bg-cloud rounded-full px-2 py-0.5">Cada mes</span>
      </div>
      <div className="text-[11.5px] text-steel mb-3">
        Sube una vez al mes el reporte de productos con 200 o más movimientos (código, descripción, total de movimientos). Estos ganadores se suman a los de ATOM para armar Sugerencias de Combos.
      </div>

      {err && <div className="text-red text-[12.5px] mb-2.5">{err}</div>}

      {phase !== "preview" && (
        <div className="mb-3">
          <label className="block mb-1 text-[10px] uppercase tracking-wide text-steel">Mes del reporte</label>
          <select className="rounded border border-rule bg-cloud px-2.5 py-2 text-[13px] font-mono" value={month} onChange={(e) => setMonth(e.target.value)}>
            {recentMonths().map((m) => (
              <option key={m} value={m}>
                {monthLabel(m)}
                {monthsWithData.has(m) ? " · ya cargado" : ""}
                {m === currentMonth() ? " (actual)" : ""}
              </option>
            ))}
          </select>
          {!withinWindow && (
            <div className="mt-1.5 text-[11px]" style={{ color: "#D9A441" }}>
              ⚠️ Ya pasaron los primeros 3 días del mes — igual puedes subirlo, pero lo ideal es hacerlo apenas empiece el mes.
            </div>
          )}
        </div>
      )}

      {phase !== "preview" && alreadyLoaded && (
        <div className="bg-gold/10 border border-gold/30 rounded-md p-3 mb-3.5 text-[12.5px]" style={{ color: "#D9A441" }}>
          <div className="flex items-center gap-1.5 font-semibold">
            <AlertTriangle size={14} /> Ya existe un reporte cargado para {monthLabel(month)}.
          </div>
          <div className="text-steel mt-1">Si subes uno nuevo, se <b className="text-ink">reemplaza por completo</b> ese mes — útil si detectaste un error.</div>
        </div>
      )}

      {phase === "idle" && (
        <label
          className={`flex flex-col items-center justify-center gap-1.5 border-[1.5px] border-dashed rounded-md py-7 cursor-pointer transition-colors ${
            dragOver ? "border-teal bg-teal/5" : "border-rule hover:border-teal"
          }`}
          onDragOver={(e) => {
            e.preventDefault();
            setDragOver(true);
          }}
          onDragLeave={(e) => {
            e.preventDefault();
            setDragOver(false);
          }}
          onDrop={(e) => {
            e.preventDefault();
            setDragOver(false);
            const file = e.dataTransfer.files?.[0];
            if (file) handleFile(file);
          }}
        >
          <Upload size={22} className="text-steel" />
          <div className="text-[13px] font-semibold">Arrastra tu reporte aquí o haz clic para elegirlo</div>
          <div className="text-[11px] text-steel">Formato .xlsx o .xls — código, descripción, total de movimientos</div>
          <input type="file" accept=".xlsx,.xls" className="hidden" onChange={(e) => e.target.files?.[0] && handleFile(e.target.files[0])} />
        </label>
      )}

      {phase === "processing" && (
        <div className="flex items-center justify-center gap-2.5 py-7 text-steel text-[13px]">
          <span className="w-4 h-4 rounded-full border-2 border-rule border-t-teal animate-spin" /> Leyendo reporte…
        </div>
      )}

      {phase === "preview" && preview && (
        <div>
          <div className="text-[11.5px] text-steel mb-2.5">
            {preview.rows.length} producto{preview.rows.length === 1 ? "" : "s"} ganador{preview.rows.length === 1 ? "" : "es"} reconocido{preview.rows.length === 1 ? "" : "s"} para {monthLabel(preview.month)}.
          </div>
          <div className="overflow-x-auto mb-3 max-h-96">
            <table className="w-full text-[12px] border-collapse">
              <thead className="sticky top-0 bg-surface">
                <tr>
                  <th className="text-left font-mono text-[9.5px] uppercase text-steel pb-1.5">Producto</th>
                  <th className="text-right font-mono text-[9.5px] uppercase text-steel pb-1.5">Movimientos</th>
                </tr>
              </thead>
              <tbody>
                {preview.rows.map((r) => (
                  <tr key={r.catalogItemId} className="border-t border-rule/50">
                    <td className="py-1.5 font-semibold truncate max-w-96">{r.catalogItemName}</td>
                    <td className="py-1.5 text-right font-mono">{r.unitsMoved.toLocaleString("es-MX")}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {warnings.length > 0 && (
            <div className="flex flex-col gap-1 mb-3">
              {warnings.map((w, i) => (
                <div key={i} className="text-[11.5px] flex items-start gap-1.5" style={{ color: "#D9A441" }}>
                  <AlertTriangle size={13} className="mt-0.5 shrink-0" /> {w}
                </div>
              ))}
            </div>
          )}
          <div className="flex items-center gap-2.5">
            <button
              type="button"
              disabled={busy || preview.rows.length === 0}
              className="rounded border border-teal bg-teal px-4 py-2 text-[13px] font-semibold text-navy cursor-pointer disabled:opacity-60"
              onClick={confirmSave}
            >
              {alreadyLoaded ? "Reemplazar" : "Confirmar y guardar"} {monthLabel(preview.month)}
            </button>
            <button type="button" className="text-steel text-[13px] cursor-pointer" onClick={reset}>
              Cancelar
            </button>
          </div>
        </div>
      )}

      {toast && phase === "idle" && (
        <div className="mt-3 flex items-center gap-2 text-teal text-[12.5px] bg-teal/10 border border-teal/30 rounded-md px-3 py-2">
          <CheckCircle2 size={14} /> {toast}
        </div>
      )}
    </div>
  );
}
