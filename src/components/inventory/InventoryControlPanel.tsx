"use client";

import { useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { CheckCircle2, Upload, AlertTriangle, TrendingDown, Minus } from "lucide-react";
import type { InventoryControlPeriodDTO } from "@/lib/inventoryKpis";
import { usePasteFile } from "@/lib/usePasteFile";
import { uploadFile } from "@/lib/uploadFile";

const MONTH_NAMES = ["Ene", "Feb", "Mar", "Abr", "May", "Jun", "Jul", "Ago", "Sep", "Oct", "Nov", "Dic"];
function monthLabel(period: string) {
  const [y, m] = period.split("-");
  return `${MONTH_NAMES[Number(m) - 1] ?? m} ${y}`;
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
}: {
  currentPeriodDefault: string;
  periods: InventoryControlPeriodDTO[];
}) {
  const router = useRouter();
  const [period, setPeriod] = useState(currentPeriodDefault);
  const selectedData = periods.find((p) => p.period === period) ?? null;
  const [value, setValue] = useState(selectedData?.value !== null && selectedData?.value !== undefined ? String(selectedData.value) : "");
  const [savingValue, setSavingValue] = useState(false);
  const [toast, setToast] = useState("");
  const [err, setErr] = useState("");

  const [proofUrl, setProofUrl] = useState<string | null>(selectedData?.proofUrl ?? null);
  const [uploadingProof, setUploadingProof] = useState(false);
  const [verifying, setVerifying] = useState(false);
  const [verifyResult, setVerifyResult] = useState<{ readAmount: number | null; matches: boolean } | null>(null);
  const [confirming, setConfirming] = useState(false);

  function changePeriod(newPeriod: string) {
    setPeriod(newPeriod);
    const data = periods.find((p) => p.period === newPeriod) ?? null;
    setValue(data?.value !== null && data?.value !== undefined ? String(data.value) : "");
    setProofUrl(data?.proofUrl ?? null);
    setVerifyResult(null);
    setConfirming(false);
    setToast("");
    setErr("");
  }

  const { onPaste, onMouseEnter, onMouseLeave } = usePasteFile((file) => uploadProof(file));
  const proofFileInputRef = useRef<HTMLInputElement>(null);

  async function uploadProof(file: File) {
    setUploadingProof(true);
    setErr("");
    const res = await uploadFile(file, "inventory-proofs");
    setUploadingProof(false);
    if (!res.ok) { setErr(res.error); return; }
    setProofUrl(res.url);
    setVerifyResult(null);
    await verifyProof(res.url);
  }

  async function verifyProof(url: string) {
    const n = Number(value);
    if (Number.isNaN(n) || n < 0) return;
    setVerifying(true);
    const res = await fetch("/api/inventory-control/verify-value-proof", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ proofUrl: url, expectedValue: n }),
    });
    setVerifying(false);
    const json = await res.json().catch(() => null);
    if (!res.ok) { setErr(json?.error ?? "No se pudo leer la captura."); return; }
    setVerifyResult({ readAmount: json.readAmount, matches: json.matches });
  }

  function openConfirm() {
    const n = Number(value);
    if (Number.isNaN(n) || n < 0) { setErr("Ingresa un valor válido."); return; }
    setErr("");
    setConfirming(true);
  }

  async function confirmSave() {
    const n = Number(value);
    setSavingValue(true);
    setErr("");
    const res = await fetch("/api/inventory-control/monthly-value", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        period, value: n, proofUrl,
        aiReadAmount: verifyResult?.readAmount ?? null,
        aiMatches: proofUrl ? (verifyResult?.matches ?? null) : null,
      }),
    });
    setSavingValue(false);
    if (!res.ok) { setErr("No se pudo guardar."); return; }
    setConfirming(false);
    setToast(`✅ Inventario de ${monthLabel(period)} guardado.`);
    router.refresh();
  }

  // --- Sección 2: Excel mensual de stock por SKU ("Productos sin movimiento") ---
  const [snapPeriod, setSnapPeriod] = useState(currentPeriodDefault);
  const snapData = periods.find((p) => p.period === snapPeriod) ?? null;
  const [snapPhase, setSnapPhase] = useState<"idle" | "processing" | "preview">("idle");
  const [snapPreview, setSnapPreview] = useState<SnapshotPreview | null>(null);
  const [snapWarnings, setSnapWarnings] = useState<string[]>([]);
  const [snapErr, setSnapErr] = useState("");
  const [snapBusy, setSnapBusy] = useState(false);
  const [snapToast, setSnapToast] = useState("");

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
    resetSnapUpload();
    setSnapToast(`✅ ${monthLabel(snapPreview.period)} guardado — ${json.count} productos. Los KPIs ya se actualizaron.`);
    router.refresh();
  }

  return (
    <div className="flex flex-col gap-4.5">
      {err && <div className="text-red text-[12.5px]">{err}</div>}
      {toast && <div className="flex items-center gap-2 text-teal text-[12.5px] bg-teal/10 border border-teal/30 rounded-md px-3 py-2"><CheckCircle2 size={14} /> {toast}</div>}

      <div className="bg-surface border border-rule rounded-md p-4.5">
        <div className="flex items-center justify-between mb-1">
          <div className="font-semibold text-[13.5px]">Valor de inventario del mes</div>
          <span className="font-mono text-[10px] uppercase text-steel bg-cloud rounded-full px-2 py-0.5">Cada mes</span>
        </div>
        <div className="text-[11.5px] text-steel mb-3">El mismo total que ya ves en tu reporte de saldos costeados y valorizados.</div>

        {!confirming && (
          <div className="mb-3">
            <label className="block mb-1 text-[10px] uppercase tracking-wide text-steel">Mes que estás cargando</label>
            <select
              className="rounded border border-rule bg-cloud px-2.5 py-2 text-[13px] font-mono"
              value={period}
              onChange={(e) => changePeriod(e.target.value)}
            >
              {periods.map((p) => (
                <option key={p.period} value={p.period}>
                  {monthLabel(p.period)}{p.value !== null ? " · ya cargado" : ""}{p.period === currentPeriodDefault ? " (actual)" : ""}
                </option>
              ))}
            </select>
          </div>
        )}

        {!confirming ? (
          <>
            <div className="flex items-center gap-2.5 mb-3">
              <input
                type="number" step="any" min={0}
                className="w-48 rounded border border-rule bg-cloud px-2.5 py-2 text-[13px] font-mono text-right"
                value={value}
                onChange={(e) => { setValue(e.target.value); setVerifyResult(null); }}
                placeholder="0.00"
              />
              <button
                type="button" disabled={savingValue}
                className="rounded border border-blue bg-blue px-3.5 py-2 text-[12.5px] font-semibold text-white cursor-pointer disabled:opacity-60"
                onClick={openConfirm}
              >
                Guardar
              </button>
            </div>

            {proofUrl ? (
              <div className="flex items-center gap-2 text-[11.5px] text-teal">
                <CheckCircle2 size={13} /> Captura adjunta
                <button type="button" className="text-steel underline cursor-pointer ml-1" onClick={() => { setProofUrl(null); setVerifyResult(null); }}>quitar</button>
              </div>
            ) : uploadingProof ? (
              <div className="text-[11.5px] text-steel">Subiendo captura…</div>
            ) : (
              <label
                tabIndex={0}
                onPaste={onPaste} onMouseEnter={onMouseEnter} onMouseLeave={onMouseLeave}
                onClick={(e) => e.preventDefault()}
                className="flex items-center gap-2 border-[1.5px] border-dashed border-rule rounded-md px-3 py-2.5 cursor-pointer hover:border-teal transition-colors text-[11.5px] text-steel w-fit"
              >
                <Upload size={13} />
                <span>De preferencia, adjunta una captura de tu reporte con este valor — pégala aquí (Ctrl+V)</span>
                <button type="button" className="text-[10.5px] underline decoration-dotted opacity-80 hover:opacity-100 cursor-pointer" onClick={(e) => { e.stopPropagation(); proofFileInputRef.current?.click(); }}>
                  o selecciona un archivo
                </button>
                <input ref={proofFileInputRef} type="file" accept="image/*" className="hidden" onChange={(e) => e.target.files?.[0] && uploadProof(e.target.files[0])} />
              </label>
            )}
            {verifying && <div className="text-[11px] text-steel mt-1.5">La IA está leyendo la captura…</div>}
          </>
        ) : (
          <div className="bg-cloud rounded-md p-3.5">
            <div className="text-[12.5px] font-semibold mb-2">¿Confirmas que este es el valor correcto de {monthLabel(period)}?</div>
            <div className="font-display text-[22px] font-bold mb-2">{money(Number(value))}</div>
            {proofUrl && verifyResult && (
              verifyResult.matches ? (
                <div className="flex items-center gap-2 text-[11.5px] text-teal bg-teal/10 border border-teal/30 rounded-md px-2.5 py-1.5 mb-2.5">
                  <CheckCircle2 size={13} /> La IA leyó {money(verifyResult.readAmount ?? 0)} en la captura — coincide.
                </div>
              ) : (
                <div className="flex items-center gap-2 text-[11.5px] text-red bg-red/10 border border-red/30 rounded-md px-2.5 py-1.5 mb-2.5">
                  <AlertTriangle size={13} />
                  {verifyResult.readAmount !== null
                    ? `La IA leyó ${money(verifyResult.readAmount)} en la captura — no coincide con lo que escribiste. Revisa antes de continuar.`
                    : "La IA no pudo leer un monto claro en la captura."}
                </div>
              )
            )}
            <div className="flex items-center gap-2">
              <button type="button" disabled={savingValue} className="rounded bg-blue text-white px-3.5 py-2 text-[12.5px] font-semibold cursor-pointer disabled:opacity-60" onClick={confirmSave}>
                Sí, guardar
              </button>
              <button type="button" className="text-steel text-[12.5px] cursor-pointer" onClick={() => setConfirming(false)}>
                Cancelar, revisar
              </button>
            </div>
          </div>
        )}
      </div>

      <div className="bg-surface border border-rule rounded-md p-4.5">
        <div className="flex items-center justify-between mb-1">
          <div className="font-semibold text-[13.5px]">Productos sin movimiento — stock por SKU</div>
          <span className="font-mono text-[10px] uppercase text-steel bg-cloud rounded-full px-2 py-0.5">Cada mes</span>
        </div>
        <div className="text-[11.5px] text-steel mb-3">
          Sube el mismo reporte de saldos costeados y valorizados (código, costo promedio, descripción, stock actual). DAFLOW compara cada producto contra el mes anterior y arma el ranking de productos sin movimiento solo — ya no hace falta escribirlos a mano.
        </div>

        {snapErr && <div className="text-red text-[12.5px] mb-2.5">{snapErr}</div>}

        {snapPhase !== "preview" && (
          <div className="mb-3">
            <label className="block mb-1 text-[10px] uppercase tracking-wide text-steel">Mes del reporte</label>
            <select
              className="rounded border border-rule bg-cloud px-2.5 py-2 text-[13px] font-mono"
              value={snapPeriod}
              onChange={(e) => changeSnapPeriod(e.target.value)}
            >
              {periods.map((p) => (
                <option key={p.period} value={p.period}>
                  {monthLabel(p.period)}{p.hasSnapshot ? " · ya cargado" : ""}{p.period === currentPeriodDefault ? " (actual)" : ""}
                </option>
              ))}
            </select>
          </div>
        )}

        {snapPhase !== "preview" && snapData?.hasSnapshot && (
          <div className="bg-gold/10 border border-gold/30 rounded-md p-3 mb-3.5 text-[12.5px]" style={{ color: "#D9A441" }}>
            <div className="flex items-center gap-1.5 font-semibold">
              <AlertTriangle size={14} /> Ya existe un reporte cargado para {monthLabel(snapPeriod)}.
            </div>
            <div className="text-steel mt-1">Si subes uno nuevo, se <b className="text-ink">reemplaza por completo</b> el mes — útil si detectaste un error.</div>
          </div>
        )}

        {snapPhase === "idle" && (
          <label className="flex flex-col items-center justify-center gap-1.5 border-[1.5px] border-dashed border-rule rounded-md py-7 cursor-pointer hover:border-teal transition-colors">
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
                ? <>Comparando contra <b className="text-ink">{monthLabel(snapPreview.previousPeriod)}</b> (el mes anterior con datos cargados).</>
                : <>No hay un mes anterior cargado todavía — este será el primer punto de comparación, ningún producto se marcará sin movimiento aún.</>}
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
                      <td className="py-1.5 font-semibold truncate max-w-56">{r.description}</td>
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
                {snapData?.hasSnapshot ? "Reemplazar" : "Confirmar y guardar"} {monthLabel(snapPreview.period)}
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
      </div>
    </div>
  );
}
