"use client";

import { useState } from "react";
import { Check, Plus, X } from "lucide-react";
import { ProductMatchPicker, type MatchCatalogItem, type ProductMatchResult } from "@/components/merchandise-reentry/ProductMatchPicker";
import { CARRIER_LABELS, SOURCE_AREA_LABELS, MKT_CANCEL_REASONS, FULFILLMENT_CANCEL_REASONS } from "@/lib/cancelledGuidesLabels";

type Row = { selected: MatchCatalogItem | null; manualName: string; quantity: string };

async function postJson(url: string, body?: unknown) {
  const res = await fetch(url, { method: "POST", headers: { "Content-Type": "application/json" }, body: body ? JSON.stringify(body) : undefined });
  const data = await res.json().catch(() => null);
  if (!res.ok) throw new Error(data?.error ?? "Ocurrió un error.");
  return data;
}

export function CancelledGuideSubmitForm({ onSubmitted }: { onSubmitted?: () => void }) {
  const [sourceArea, setSourceArea] = useState<"MKT_DAMIAN" | "MKT_PROVEDIX" | "FULFILLMENT" | "">("");
  const [guideNumber, setGuideNumber] = useState("");
  const [carrier, setCarrier] = useState("");
  const [reason, setReason] = useState("");
  const [reasonOther, setReasonOther] = useState("");
  const [rows, setRows] = useState<Row[]>([{ selected: null, manualName: "", quantity: "" }]);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [sent, setSent] = useState(false);

  const reasonOptions = sourceArea === "FULFILLMENT" ? FULFILLMENT_CANCEL_REASONS : sourceArea ? MKT_CANCEL_REASONS : [];
  const finalReason = reason === "Otro" ? reasonOther.trim() : reason;

  const validRows = rows.filter((r) => (r.selected || r.manualName.trim()) && Number(r.quantity) > 0);
  const canSave = !!sourceArea && guideNumber.trim().length > 0 && !!carrier && !!finalReason && validRows.length > 0 && !saving;

  function reset() {
    setSourceArea("");
    setGuideNumber("");
    setCarrier("");
    setReason("");
    setReasonOther("");
    setRows([{ selected: null, manualName: "", quantity: "" }]);
    setSent(false);
  }

  async function save() {
    setSaving(true);
    setError("");
    try {
      await postJson("/api/cancelled-guides", {
        sourceArea,
        guideNumber: guideNumber.trim(),
        carrier,
        reason: finalReason,
        items: validRows.map((r) => ({ catalogItemId: r.selected?.id, declaredName: r.selected ? undefined : r.manualName.trim(), quantity: Number(r.quantity) })),
      });
      setSent(true);
      onSubmitted?.();
    } catch (e) {
      setError(e instanceof Error ? e.message : "No se pudo enviar.");
    } finally {
      setSaving(false);
    }
  }

  if (sent) {
    return (
      <div className="bg-surface border border-rule rounded-md p-6 max-w-sm text-center">
        <div className="w-11 h-11 rounded-full bg-green/15 border border-green/40 flex items-center justify-center mx-auto mb-3">
          <Check size={20} className="text-green" />
        </div>
        <div className="font-display font-bold text-[15px] mb-1.5">Reportado</div>
        <p className="text-[12.5px] text-steel mb-4">Fulfillment e Inventario ya fueron avisados para que no la despachen.</p>
        <button type="button" className="text-[12.5px] font-bold text-teal cursor-pointer" onClick={reset}>Reportar otra</button>
      </div>
    );
  }

  return (
    <div className="bg-surface border border-rule rounded-md p-3.5 flex flex-col gap-3.5 max-w-md">
      <div>
        <label className="block mb-1.5 text-[10px] font-semibold uppercase tracking-wide text-steel">Área / bodega</label>
        <div className="flex flex-col gap-1.5">
          {(["MKT_DAMIAN", "MKT_PROVEDIX", "FULFILLMENT"] as const).map((a) => (
            <button key={a} type="button" onClick={() => { setSourceArea(a); setReason(""); }} className={`text-left text-[12.5px] font-semibold rounded-md px-2.5 py-1.5 border cursor-pointer ${sourceArea === a ? "border-teal text-teal bg-teal/10" : "border-rule text-steel"}`}>
              {SOURCE_AREA_LABELS[a]}
            </button>
          ))}
        </div>
      </div>

      <div>
        <label className="block mb-1.5 text-[10px] font-semibold uppercase tracking-wide text-steel">Número de guía</label>
        <input type="text" className="w-full rounded border border-rule bg-cloud px-2.5 py-1.5 text-[12.5px]" value={guideNumber} onChange={(e) => setGuideNumber(e.target.value)} />
      </div>

      <div>
        <label className="block mb-1.5 text-[10px] font-semibold uppercase tracking-wide text-steel">Transportadora</label>
        <div className="flex gap-1.5 flex-wrap">
          {Object.entries(CARRIER_LABELS).map(([key, label]) => (
            <button key={key} type="button" onClick={() => setCarrier(key)} className={`text-[11.5px] font-semibold rounded-full px-2.5 py-1 border cursor-pointer ${carrier === key ? "border-teal text-teal bg-teal/15" : "border-rule text-steel"}`}>
              {label}
            </button>
          ))}
        </div>
      </div>

      {sourceArea && (
        <div>
          <label className="block mb-1.5 text-[10px] font-semibold uppercase tracking-wide text-steel">Motivo</label>
          <div className="flex gap-1.5 flex-wrap">
            {[...reasonOptions, "Otro"].map((r) => (
              <button key={r} type="button" onClick={() => setReason(r)} className={`text-[11.5px] font-semibold rounded-full px-2.5 py-1 border cursor-pointer ${reason === r ? "border-teal text-teal bg-teal/15" : "border-rule text-steel"}`}>
                {r}
              </button>
            ))}
          </div>
          {reason === "Otro" && (
            <input type="text" placeholder="Describe el motivo" className="w-full mt-1.5 rounded border border-rule bg-cloud px-2.5 py-1.5 text-[12px]" value={reasonOther} onChange={(e) => setReasonOther(e.target.value)} />
          )}
        </div>
      )}

      <div>
        <label className="block mb-1.5 text-[10px] font-semibold uppercase tracking-wide text-steel">Productos y cantidades de esta guía</label>
        <div className="flex flex-col gap-2">
          {rows.map((row, i) => (
            <div key={i} className="bg-cloud rounded-md p-2.5">
              <div className="flex items-center justify-between mb-1.5">
                <span className="text-[10.5px] font-semibold text-steel">Producto {i + 1}</span>
                {rows.length > 1 && (
                  <button type="button" className="text-steel hover:text-red cursor-pointer" onClick={() => setRows((rs) => rs.filter((_, j) => j !== i))}>
                    <X size={13} />
                  </button>
                )}
              </div>
              {row.selected ? (
                <div className="flex items-center gap-2.5 bg-green/10 border border-green/35 rounded-md p-2 mb-2">
                  <div className="flex-1 min-w-0 text-[12px] font-semibold truncate">{row.selected.name}</div>
                  <button type="button" className="text-[11px] font-semibold text-blue cursor-pointer" onClick={() => setRows((rs) => rs.map((r, j) => (j === i ? { ...r, selected: null } : r)))}>Cambiar</button>
                </div>
              ) : row.manualName ? (
                <div className="flex items-center gap-2.5 bg-surface rounded-md p-2 mb-2">
                  <div className="flex-1 min-w-0 text-[12px] font-medium truncate">{row.manualName}</div>
                  <button type="button" className="text-[11px] font-semibold text-blue cursor-pointer" onClick={() => setRows((rs) => rs.map((r, j) => (j === i ? { ...r, manualName: "" } : r)))}>Cambiar</button>
                </div>
              ) : (
                <ProductMatchPicker
                  referencePhotoUrl={null}
                  onConfirm={(r: ProductMatchResult) => setRows((rs) => rs.map((row2, j) => (j === i ? ("catalogItem" in r ? { ...row2, selected: r.catalogItem, manualName: "" } : { ...row2, manualName: r.manualName, selected: null }) : row2)))}
                />
              )}
              <div className="flex items-center gap-2">
                <span className="text-[11px] text-steel">Cantidad</span>
                <input type="number" min={1} className="w-20 rounded border border-rule bg-surface px-2 py-1 text-[12px] font-bold" value={row.quantity} onChange={(e) => setRows((rs) => rs.map((r, j) => (j === i ? { ...r, quantity: e.target.value } : r)))} />
              </div>
            </div>
          ))}
        </div>
        <button type="button" className="flex items-center gap-1.5 text-[11.5px] font-semibold text-blue cursor-pointer mt-1.5" onClick={() => setRows((rs) => [...rs, { selected: null, manualName: "", quantity: "" }])}>
          <Plus size={13} /> Agregar otro producto
        </button>
      </div>

      {error && <div className="text-red text-[11.5px]">{error}</div>}
      <button type="button" disabled={!canSave} className="rounded border border-teal bg-teal px-3 py-2 text-[12.5px] font-bold text-navy cursor-pointer disabled:opacity-40" onClick={save}>
        {saving ? "Enviando…" : "Reportar guía cancelada"}
      </button>
    </div>
  );
}
