"use client";

import { useState } from "react";
import { Check, Plus, X } from "lucide-react";
import { ProductMatchPicker, type MatchCatalogItem, type ProductMatchResult } from "@/components/merchandise-reentry/ProductMatchPicker";
import { CARRIER_LABELS, SOURCE_AREA_LABELS, MKT_CANCEL_REASONS, FULFILLMENT_CANCEL_REASONS, splitGuideBuffer, isPossibleGuidePrefix } from "@/lib/cancelledGuidesLabels";
import { CatalogCode } from "@/components/shared/CatalogCode";

type ProductRow = { selected: MatchCatalogItem | null; quantity: string };
type DetectedGuide = { id: string; carrier: keyof typeof CARRIER_LABELS; guideNumber: string; rows: ProductRow[] };

async function postJson(url: string, body?: unknown) {
  const res = await fetch(url, { method: "POST", headers: { "Content-Type": "application/json" }, body: body ? JSON.stringify(body) : undefined });
  const data = await res.json().catch(() => null);
  if (!res.ok) throw new Error(data?.error ?? "Ocurrió un error.");
  return data;
}

export function CancelledGuideSubmitForm({ onSubmitted }: { onSubmitted?: () => void }) {
  const [sourceArea, setSourceArea] = useState<"MKT_DAMIAN" | "MKT_PROVEDIX" | "FULFILLMENT" | "">("");
  const [guideBuffer, setGuideBuffer] = useState("");
  const [guides, setGuides] = useState<DetectedGuide[]>([]);
  const [reason, setReason] = useState("");
  const [reasonOther, setReasonOther] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [sentCount, setSentCount] = useState(0);

  const reasonOptions = sourceArea === "FULFILLMENT" ? FULFILLMENT_CANCEL_REASONS : sourceArea ? MKT_CANCEL_REASONS : [];
  const finalReason = reason === "Otro" ? reasonOther.trim() : reason;
  const bufferInvalid = guideBuffer.length > 0 && !isPossibleGuidePrefix(guideBuffer);

  const guidesReady = guides.length > 0 && guides.every((g) => g.rows.some((r) => r.selected && Number(r.quantity) > 0));
  const canSave = !!sourceArea && guidesReady && !!finalReason && guideBuffer.trim().length === 0 && !saving;

  function reset() {
    setSourceArea("");
    setGuideBuffer("");
    setGuides([]);
    setReason("");
    setReasonOther("");
    setSentCount(0);
  }

  function handleBufferChange(value: string) {
    const { extracted, remainder } = splitGuideBuffer(value);
    if (extracted.length > 0) {
      setGuides((gs) => [...gs, ...extracted.map((e) => ({ id: crypto.randomUUID(), carrier: e.carrier, guideNumber: e.guideNumber, rows: [{ selected: null, quantity: "" }] }))]);
    }
    setGuideBuffer(remainder);
  }

  function removeGuide(id: string) {
    setGuides((gs) => gs.filter((g) => g.id !== id));
  }

  function updateGuideRows(id: string, updater: (rows: ProductRow[]) => ProductRow[]) {
    setGuides((gs) => gs.map((g) => (g.id === id ? { ...g, rows: updater(g.rows) } : g)));
  }

  async function save() {
    setSaving(true);
    setError("");
    let done = 0;
    try {
      for (const g of guides) {
        const validRows = g.rows.filter((r) => r.selected && Number(r.quantity) > 0);
        await postJson("/api/cancelled-guides", {
          sourceArea,
          guideNumber: g.guideNumber,
          carrier: g.carrier,
          reason: finalReason,
          items: validRows.map((r) => ({ catalogItemId: r.selected!.id, quantity: Number(r.quantity) })),
        });
        done += 1;
      }
      setSentCount(done);
      onSubmitted?.();
    } catch (e) {
      setError(`${e instanceof Error ? e.message : "No se pudo enviar."} (se reportaron ${done} de ${guides.length} guías antes de la falla)`);
      setGuides((gs) => gs.slice(done));
    } finally {
      setSaving(false);
    }
  }

  if (sentCount > 0) {
    return (
      <div className="bg-surface border border-rule rounded-md p-6 max-w-sm text-center">
        <div className="w-11 h-11 rounded-full bg-green/15 border border-green/40 flex items-center justify-center mx-auto mb-3">
          <Check size={20} className="text-green" />
        </div>
        <div className="font-display font-bold text-[15px] mb-1.5">{sentCount === 1 ? "Reportada" : `${sentCount} guías reportadas`}</div>
        <p className="text-[12.5px] text-steel mb-4">Fulfillment e Inventario ya fueron avisados para que no las despachen.</p>
        <button type="button" className="text-[12.5px] font-bold text-teal cursor-pointer" onClick={reset}>Reportar otra</button>
      </div>
    );
  }

  const carriersInOrder = Array.from(new Set(guides.map((g) => g.carrier)));

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
        <label className="block mb-1.5 text-[10px] font-semibold uppercase tracking-wide text-steel">Número(s) de guía</label>
        <input
          type="text"
          autoComplete="off"
          placeholder="Escaneá o tipeá las guías seguidas"
          className={`w-full rounded border bg-cloud px-2.5 py-1.5 text-[12.5px] ${bufferInvalid ? "border-red" : "border-rule"}`}
          value={guideBuffer}
          onChange={(e) => handleBufferChange(e.target.value)}
        />
        {bufferInvalid && <p className="text-red text-[11px] mt-1">No reconozco esta transportadora — revisá el número.</p>}
        <p className="text-[11px] text-steel mt-1">La transportadora se detecta sola por el número — no hace falta elegirla. Podés seguir escaneando o tipeando la próxima guía apenas se cierra la anterior.</p>
      </div>

      {guides.length > 0 && (
        <div className="flex flex-col gap-3">
          {carriersInOrder.map((carrierKey) => (
            <div key={carrierKey}>
              <div className="text-[10px] font-semibold uppercase tracking-wide text-teal mb-1.5">{CARRIER_LABELS[carrierKey]}</div>
              <div className="flex flex-col gap-2">
                {guides.filter((g) => g.carrier === carrierKey).map((g) => (
                  <div key={g.id} className="bg-cloud rounded-md p-2.5">
                    <div className="flex items-center justify-between mb-1.5">
                      <span className="text-[12px] font-bold">{g.guideNumber}</span>
                      <button type="button" className="text-steel hover:text-red cursor-pointer" onClick={() => removeGuide(g.id)}>
                        <X size={13} />
                      </button>
                    </div>
                    <div className="flex flex-col gap-1.5">
                      {g.rows.map((row, i) => (
                        <div key={i} className="bg-surface rounded-md p-2">
                          <div className="flex items-center justify-between mb-1.5">
                            <span className="text-[10.5px] font-semibold text-steel">Producto {i + 1}</span>
                            {g.rows.length > 1 && (
                              <button type="button" className="text-steel hover:text-red cursor-pointer" onClick={() => updateGuideRows(g.id, (rows) => rows.filter((_, j) => j !== i))}>
                                <X size={12} />
                              </button>
                            )}
                          </div>
                          {row.selected ? (
                            <div className="flex items-center gap-2.5 bg-green/10 border border-green/35 rounded-md p-2 mb-2">
                              <div className="flex-1 min-w-0 text-[12px] font-semibold flex items-center gap-1.5">
                                <CatalogCode code={row.selected.justCode} />
                                <span className="truncate">{row.selected.name}</span>
                              </div>
                              <button type="button" className="text-[11px] font-semibold text-blue cursor-pointer" onClick={() => updateGuideRows(g.id, (rows) => rows.map((r, j) => (j === i ? { ...r, selected: null } : r)))}>Cambiar</button>
                            </div>
                          ) : (
                            <ProductMatchPicker
                              referencePhotoUrl={null}
                              onConfirm={(r: ProductMatchResult) => updateGuideRows(g.id, (rows) => rows.map((row2, j) => (j === i ? { ...row2, selected: r } : row2)))}
                            />
                          )}
                          <div className="flex items-center gap-2">
                            <span className="text-[11px] text-steel">Cantidad</span>
                            <input type="number" min={1} className="w-20 rounded border border-rule bg-cloud px-2 py-1 text-[12px] font-bold" value={row.quantity} onChange={(e) => updateGuideRows(g.id, (rows) => rows.map((r, j) => (j === i ? { ...r, quantity: e.target.value } : r)))} />
                          </div>
                        </div>
                      ))}
                    </div>
                    <button type="button" className="flex items-center gap-1.5 text-[11px] font-semibold text-blue cursor-pointer mt-1.5" onClick={() => updateGuideRows(g.id, (rows) => [...rows, { selected: null, quantity: "" }])}>
                      <Plus size={12} /> Agregar otro producto
                    </button>
                  </div>
                ))}
              </div>
            </div>
          ))}
        </div>
      )}

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

      {error && <div className="text-red text-[11.5px]">{error}</div>}
      <button type="button" disabled={!canSave} className="rounded border border-teal bg-teal px-3 py-2 text-[12.5px] font-bold text-navy cursor-pointer disabled:opacity-40" onClick={save}>
        {saving ? "Enviando…" : guides.length > 1 ? `Reportar ${guides.length} guías canceladas` : "Reportar guía cancelada"}
      </button>
    </div>
  );
}
