"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { CheckCircle2, Pencil, Plus, Upload, AlertTriangle } from "lucide-react";
import { isReviewDue, daysUntilDue, quarterLabel } from "@/lib/inventoryKpisCalc";
import type { StaleProductDTO } from "@/lib/inventoryKpis";
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

export function InventoryControlPanel({
  period,
  currentInventoryValue,
  products,
  currentQuarter,
}: {
  period: string;
  currentInventoryValue: number | null;
  products: StaleProductDTO[];
  currentQuarter: string;
}) {
  const router = useRouter();
  const [value, setValue] = useState(currentInventoryValue !== null ? String(currentInventoryValue) : "");
  const [savingValue, setSavingValue] = useState(false);
  const [toast, setToast] = useState("");
  const [err, setErr] = useState("");

  const [proofUrl, setProofUrl] = useState<string | null>(null);
  const [uploadingProof, setUploadingProof] = useState(false);
  const [verifying, setVerifying] = useState(false);
  const [verifyResult, setVerifyResult] = useState<{ readAmount: number | null; matches: boolean } | null>(null);
  const [confirming, setConfirming] = useState(false);

  const [newName, setNewName] = useState("");
  const [newValue, setNewValue] = useState("");
  const [addingProduct, setAddingProduct] = useState(false);

  const [editingId, setEditingId] = useState<string | null>(null);
  const [editValue, setEditValue] = useState("");
  const [busyId, setBusyId] = useState<string | null>(null);

  const active = products.filter((p) => p.status === "active");
  const recovered = products.filter((p) => p.status === "recovered");

  const { onPaste, onMouseEnter, onMouseLeave } = usePasteFile((file) => uploadProof(file));

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
        value: n, proofUrl,
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

  async function addProduct() {
    if (!newName.trim()) return;
    const n = Number(newValue);
    if (Number.isNaN(n) || n < 0) { setErr("Ingresa un valor válido para el producto."); return; }
    setAddingProduct(true);
    setErr("");
    const res = await fetch("/api/inventory-control/stale-products", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name: newName.trim(), value: n }),
    });
    setAddingProduct(false);
    if (!res.ok) { setErr("No se pudo agregar el producto."); return; }
    setNewName("");
    setNewValue("");
    router.refresh();
  }

  async function confirmProduct(id: string, action: "stay" | "recover") {
    setBusyId(id);
    const res = await fetch(`/api/inventory-control/stale-products/${id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action }),
    });
    setBusyId(null);
    if (!res.ok) { setErr("No se pudo actualizar el producto."); return; }
    router.refresh();
  }

  async function saveEditValue(id: string) {
    const n = Number(editValue);
    if (Number.isNaN(n) || n < 0) { setErr("Ingresa un valor válido."); return; }
    setBusyId(id);
    const res = await fetch(`/api/inventory-control/stale-products/${id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ value: n }),
    });
    setBusyId(null);
    setEditingId(null);
    if (!res.ok) { setErr("No se pudo guardar el nuevo valor."); return; }
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
        <div className="text-[11.5px] text-steel mb-3">El mismo total que ya ves en tu reporte de saldos costeados y valorizados — {monthLabel(period)}.</div>

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
                onPaste={onPaste} onMouseEnter={onMouseEnter} onMouseLeave={onMouseLeave}
                className="flex items-center gap-2 border-[1.5px] border-dashed border-rule rounded-md px-3 py-2.5 cursor-pointer hover:border-teal transition-colors text-[11.5px] text-steel w-fit"
              >
                <Upload size={13} />
                <span>De preferencia, adjunta una captura de tu reporte con este valor — clic, arrastra, o Ctrl+V</span>
                <input type="file" accept="image/*" className="hidden" onChange={(e) => e.target.files?.[0] && uploadProof(e.target.files[0])} />
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
          <div className="font-semibold text-[13.5px]">Revisión de productos sin movimiento</div>
          <span className="font-mono text-[10px] uppercase text-steel bg-cloud rounded-full px-2 py-0.5">{quarterLabel(currentQuarter)}</span>
        </div>
        <div className="text-[11.5px] text-steel mb-3.5">Confirma los productos marcados antes, y agrega los nuevos que ya llevan +3 meses sin venderse. Nunca se eliminan — solo se confirman, recuperan o corrige su valor.</div>

        <div className="flex flex-col gap-2 mb-3.5">
          {active.length === 0 && <div className="text-steel text-[12px]">No hay productos marcados todavía.</div>}
          {active.map((p) => {
            const due = isReviewDue(p.lastConfirmedQuarter);
            const days = daysUntilDue(p.lastConfirmedQuarter);
            return (
              <div key={p.id} className="flex items-center justify-between gap-2.5 bg-cloud rounded-md px-3 py-2.5 text-[12.5px]">
                <div className="flex-1 min-w-0">
                  <div className="font-semibold truncate">{p.name}</div>
                  {editingId === p.id ? (
                    <div className="flex items-center gap-1.5 mt-1">
                      <input
                        type="number" step="any" min={0} autoFocus
                        className="w-28 rounded border border-rule bg-bg px-2 py-1 text-[12px] font-mono"
                        value={editValue}
                        onChange={(e) => setEditValue(e.target.value)}
                      />
                      <button type="button" className="text-teal text-[11px] font-semibold cursor-pointer" onClick={() => saveEditValue(p.id)} disabled={busyId === p.id}>Guardar</button>
                      <button type="button" className="text-steel text-[11px] cursor-pointer" onClick={() => setEditingId(null)}>Cancelar</button>
                    </div>
                  ) : (
                    <div className="flex items-center gap-1.5 text-steel font-mono text-[11.5px] mt-0.5">
                      {money(p.value)}
                      <button type="button" className="text-steel hover:text-ink cursor-pointer" title="Editar valor" onClick={() => { setEditingId(p.id); setEditValue(String(p.value)); }}>
                        <Pencil size={11} />
                      </button>
                    </div>
                  )}
                </div>
                {due ? (
                  <div className="flex items-center gap-1.5 shrink-0">
                    <button type="button" disabled={busyId === p.id} className="rounded border border-gold/40 bg-gold/10 px-2.5 py-1.5 text-[11.5px] font-semibold cursor-pointer disabled:opacity-60" style={{ color: "#D9A441" }} onClick={() => confirmProduct(p.id, "stay")}>
                      Sigue igual
                    </button>
                    <button type="button" disabled={busyId === p.id} className="rounded border border-green/40 bg-green/10 px-2.5 py-1.5 text-[11.5px] font-semibold text-green cursor-pointer disabled:opacity-60" onClick={() => confirmProduct(p.id, "recover")}>
                      Ya se vende
                    </button>
                  </div>
                ) : (
                  <span className="text-[11px] text-teal shrink-0">✓ confirmado {days > 0 ? `· vence en ${days} días` : ""}</span>
                )}
              </div>
            );
          })}
        </div>

        {recovered.length > 0 && (
          <div className="mb-3.5">
            <div className="text-[11px] font-semibold text-green mb-1.5">✓ Recuperados</div>
            <div className="flex flex-col gap-1">
              {recovered.map((p) => (
                <div key={p.id} className="text-[11.5px] text-steel flex justify-between">
                  <span>{p.name}</span><span>volvió a venderse — {quarterLabel(p.lastConfirmedQuarter)}</span>
                </div>
              ))}
            </div>
          </div>
        )}

        <div className="flex items-center gap-2 pt-3 border-t border-dashed border-rule">
          <input
            type="text" placeholder="Nombre del producto nuevo"
            className="flex-1 rounded border border-rule bg-cloud px-2.5 py-2 text-[12.5px]"
            value={newName}
            onChange={(e) => setNewName(e.target.value)}
          />
          <input
            type="number" step="any" min={0} placeholder="$ valor"
            className="w-28 rounded border border-rule bg-cloud px-2.5 py-2 text-[12.5px] font-mono"
            value={newValue}
            onChange={(e) => setNewValue(e.target.value)}
          />
          <button
            type="button" disabled={addingProduct}
            className="flex items-center gap-1 rounded border border-blue bg-blue px-3 py-2 text-[12px] font-semibold text-white cursor-pointer disabled:opacity-60"
            onClick={addProduct}
          >
            <Plus size={13} /> Agregar
          </button>
        </div>
      </div>
    </div>
  );
}
