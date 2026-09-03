"use client";

import { useState } from "react";
import { Check, X } from "lucide-react";
import { CARRIER_LABELS, SOURCE_AREA_LABELS, MKT_CANCEL_REASONS, FULFILLMENT_CANCEL_REASONS, allowedSourceAreasFor, splitGuideBuffer, isPossibleGuidePrefix } from "@/lib/cancelledGuidesLabels";

type SourceArea = "MKT_DAMIAN" | "MKT_PROVEDIX" | "MKT_SHANGHAI" | "FULFILLMENT";
type DetectedGuide = { id: string; carrier: keyof typeof CARRIER_LABELS; guideNumber: string };

async function postJson(url: string, body?: unknown) {
  const res = await fetch(url, { method: "POST", headers: { "Content-Type": "application/json" }, body: body ? JSON.stringify(body) : undefined });
  const data = await res.json().catch(() => null);
  if (!res.ok) throw new Error(data?.error ?? "Ocurrió un error.");
  return data;
}

export function CancelledGuideSubmitForm({ onSubmitted, viewerDeptCode }: { onSubmitted?: () => void; viewerDeptCode?: string | null }) {
  const areaOptions = allowedSourceAreasFor(viewerDeptCode) as SourceArea[];
  const [sourceArea, setSourceArea] = useState<SourceArea | "">("");
  const [guideBuffer, setGuideBuffer] = useState("");
  const [guides, setGuides] = useState<DetectedGuide[]>([]);
  const [reason, setReason] = useState("");
  const [reasonOther, setReasonOther] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [sentCount, setSentCount] = useState(0);
  const [duplicateWarning, setDuplicateWarning] = useState("");

  const reasonOptions = sourceArea === "FULFILLMENT" ? FULFILLMENT_CANCEL_REASONS : sourceArea ? MKT_CANCEL_REASONS : [];
  const finalReason = reason === "Otro" ? reasonOther.trim() : reason;
  const bufferInvalid = guideBuffer.length > 0 && !isPossibleGuidePrefix(guideBuffer);

  const canSave = !!sourceArea && guides.length > 0 && !!finalReason && guideBuffer.trim().length === 0 && !saving;

  function reset() {
    setSourceArea("");
    setGuideBuffer("");
    setGuides([]);
    setReason("");
    setReasonOther("");
    setSentCount(0);
    setDuplicateWarning("");
  }

  function handleBufferChange(value: string) {
    const { extracted, remainder } = splitGuideBuffer(value);
    if (extracted.length > 0) {
      setGuides((gs) => {
        const seen = new Set(gs.map((g) => g.guideNumber));
        const repeated: string[] = [];
        const toAdd: DetectedGuide[] = [];
        for (const e of extracted) {
          if (seen.has(e.guideNumber)) {
            repeated.push(e.guideNumber);
            continue;
          }
          seen.add(e.guideNumber);
          toAdd.push({ id: crypto.randomUUID(), carrier: e.carrier, guideNumber: e.guideNumber });
        }
        setDuplicateWarning(repeated.length > 0 ? `Ya está en la lista, no la agrego de nuevo: ${repeated.join(", ")}` : "");
        return toAdd.length > 0 ? [...gs, ...toAdd] : gs;
      });
    }
    setGuideBuffer(remainder);
  }

  function removeGuide(id: string) {
    setGuides((gs) => gs.filter((g) => g.id !== id));
  }

  async function save() {
    setSaving(true);
    setError("");
    try {
      await postJson("/api/cancelled-guides/batches", {
        sourceArea,
        reason: finalReason,
        guides: guides.map((g) => ({ carrier: g.carrier, guideNumber: g.guideNumber })),
      });
      setSentCount(guides.length);
      onSubmitted?.();
    } catch (e) {
      setError(e instanceof Error ? e.message : "No se pudo enviar.");
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
        <p className="text-[12.5px] text-steel mb-4">Fulfillment e Inventario ya fueron avisados para que no las despachen, y Análisis de Mercado ya recibió el lote para gestionarlo.</p>
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
          {areaOptions.map((a) => (
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
        {!bufferInvalid && duplicateWarning && <p className="text-red text-[11px] mt-1">{duplicateWarning}</p>}
        <p className="text-[11px] text-steel mt-1">La transportadora se detecta sola por el número — no hace falta elegirla. Podés seguir escaneando o tipeando la próxima guía apenas se cierra la anterior.</p>
      </div>

      {guides.length > 0 && (
        <div className="flex flex-col gap-3">
          {carriersInOrder.map((carrierKey) => (
            <div key={carrierKey}>
              <div className="text-[10px] font-semibold uppercase tracking-wide text-teal mb-1.5">{CARRIER_LABELS[carrierKey]}</div>
              <div className="flex flex-col gap-1">
                {guides.filter((g) => g.carrier === carrierKey).map((g) => (
                  <div key={g.id} className="flex items-center justify-between bg-cloud rounded-md px-2.5 py-1.5">
                    <span className="text-[12px] font-bold">{g.guideNumber}</span>
                    <button type="button" className="text-steel hover:text-red cursor-pointer" onClick={() => removeGuide(g.id)}>
                      <X size={13} />
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
