"use client";

import { useEffect, useState } from "react";
import { Camera, Check, Plus, Send, X } from "lucide-react";
import { LiveCameraCapture } from "@/components/shared/LiveCameraCapture";

const DAMAGE_REASONS = ["Producto roto", "Empaque abierto", "Humedad/manchado", "Golpeado", "Otro"];

type ItemDTO = {
  id: string;
  photoUrls: string[];
  catalogItem: { name: string; photos: string[] } | null;
  aiRecognized: boolean;
  declaredName: string | null;
  goodQty: number;
  damagedQty: number;
  damageReason: { name: string } | null;
  damageReasonOther: string | null;
};

type BatchDTO = { id: string; code: string; submittedAt: string | null; items: ItemDTO[] };

async function postJson(url: string, body?: unknown) {
  const res = await fetch(url, { method: "POST", headers: { "Content-Type": "application/json" }, body: body ? JSON.stringify(body) : undefined });
  const data = await res.json().catch(() => null);
  if (!res.ok) throw new Error(data?.error ?? "Ocurrió un error.");
  return data;
}

function itemName(item: ItemDTO) {
  return item.catalogItem?.name ?? item.declaredName ?? "Producto sin nombre";
}

export function CaptureFlow() {
  const [loading, setLoading] = useState(true);
  const [batch, setBatch] = useState<BatchDTO | null>(null);
  const [gateAnswer, setGateAnswer] = useState<"ask" | "no" | null>(null);
  const [error, setError] = useState("");
  const [adding, setAdding] = useState(false);
  const [confirmingSubmit, setConfirmingSubmit] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [sentCode, setSentCode] = useState<string | null>(null);

  function loadDraft() {
    fetch("/api/merchandise-reentry/draft")
      .then((r) => r.json())
      .then((data) => setBatch(data ?? null))
      .catch(() => setBatch(null))
      .finally(() => setLoading(false));
  }

  useEffect(loadDraft, []);

  async function confirmScanned() {
    setError("");
    try {
      const created = await postJson("/api/merchandise-reentry/draft");
      setBatch({ ...created, items: [] });
    } catch (e) {
      setError(e instanceof Error ? e.message : "No se pudo crear el lote.");
    }
  }

  async function submitBatch() {
    if (!batch) return;
    setSubmitting(true);
    setError("");
    try {
      await postJson(`/api/merchandise-reentry/batches/${batch.id}/submit`);
      setSentCode(batch.code);
      setBatch(null);
      setConfirmingSubmit(false);
    } catch (e) {
      setError(e instanceof Error ? e.message : "No se pudo enviar el lote.");
    } finally {
      setSubmitting(false);
    }
  }

  if (loading) return <div className="text-[13px] text-steel">Cargando…</div>;

  // Pantalla de éxito tras enviar
  if (sentCode) {
    return (
      <div className="bg-surface border border-rule rounded-md p-6 max-w-sm text-center">
        <div className="w-11 h-11 rounded-full bg-green/15 border border-green/40 flex items-center justify-center mx-auto mb-3">
          <Check size={20} className="text-green" />
        </div>
        <div className="font-display font-bold text-[15px] mb-1.5">{sentCode} enviado</div>
        <p className="text-[12.5px] text-steel mb-4">Ya no puedes editar esta información. Daniel la va a revisar.</p>
        <button type="button" className="text-[12.5px] font-bold text-teal cursor-pointer" onClick={() => { setSentCode(null); setGateAnswer(null); }}>
          Empezar un lote nuevo
        </button>
      </div>
    );
  }

  // Candado inicial — solo si no hay un lote en borrador ya
  if (!batch) {
    if (gateAnswer === "no") {
      return (
        <div className="bg-surface border border-red/30 rounded-md p-6 max-w-sm">
          <div className="font-display font-bold text-[15px] mb-1.5">Espera antes de continuar</div>
          <p className="text-[12.5px] text-steel mb-4">
            Esta mercadería todavía no figura como devuelta en Dropi/Rocket. Vuelve a intentarlo cuando ya esté escaneada.
          </p>
          <button type="button" className="text-[12.5px] font-bold text-teal cursor-pointer" onClick={() => setGateAnswer(null)}>
            Volver a preguntar
          </button>
        </div>
      );
    }
    return (
      <div className="bg-surface border border-rule rounded-md p-6 max-w-sm">
        <div className="font-mono text-[9.5px] font-semibold uppercase tracking-wide text-steel mb-2">Antes de empezar</div>
        <div className="font-display font-bold text-[16px] mb-4 leading-snug">
          ¿Ya fueron escaneados como devolución en el sistema de Dropi o Rocket?
        </div>
        {error && <div className="text-red text-[12px] mb-2">{error}</div>}
        <div className="flex flex-col gap-2">
          <button type="button" className="rounded border border-teal bg-teal px-3.5 py-2.5 text-[13px] font-bold text-navy cursor-pointer" onClick={confirmScanned}>
            Sí, ya fueron escaneadas
          </button>
          <button type="button" className="rounded border border-rule px-3.5 py-2.5 text-[13px] font-semibold cursor-pointer" onClick={() => setGateAnswer("no")}>
            No todavía
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="max-w-md">
      <div className="flex items-center gap-2 mb-3">
        <span className="font-mono text-[11px] font-bold text-teal">{batch.code}</span>
        <span className="font-mono text-[10px] text-steel bg-cloud rounded-full px-2 py-0.5">{batch.items.length} producto(s) agregados</span>
      </div>

      <div className="flex flex-col gap-2 mb-3">
        {batch.items.map((item) => (
          <div key={item.id} className="bg-surface border border-rule rounded-md p-3 flex items-center gap-3">
            {item.photoUrls[0] && (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={item.photoUrls[0]} alt={itemName(item)} className="w-10 h-10 object-cover rounded border border-rule shrink-0" />
            )}
            <div className="flex-1 min-w-0">
              <div className="text-[12.5px] font-semibold truncate">{itemName(item)}</div>
              <div className="text-[11px] text-steel">
                {item.goodQty > 0 && <span className="text-green font-semibold">{item.goodQty} buenas</span>}
                {item.goodQty > 0 && item.damagedQty > 0 && " · "}
                {item.damagedQty > 0 && <span className="text-red font-semibold">{item.damagedQty} dañadas</span>}
              </div>
            </div>
            <button
              type="button"
              className="text-steel hover:text-red cursor-pointer shrink-0"
              onClick={async () => {
                await fetch(`/api/merchandise-reentry/items/${item.id}`, { method: "DELETE" });
                loadDraft();
              }}
            >
              <X size={14} />
            </button>
          </div>
        ))}
      </div>

      {error && <div className="text-red text-[12px] mb-2">{error}</div>}

      {adding ? (
        <AddItemForm
          batchId={batch.id}
          onAdded={() => {
            setAdding(false);
            loadDraft();
          }}
          onCancel={() => setAdding(false)}
        />
      ) : (
        <button
          type="button"
          className="w-full flex items-center justify-center gap-1.5 rounded-md border-[1.5px] border-dashed border-rule px-3.5 py-2.5 text-[12.5px] font-semibold cursor-pointer hover:border-teal mb-2.5"
          onClick={() => setAdding(true)}
        >
          <Plus size={14} /> Agregar producto al lote
        </button>
      )}

      {!adding && batch.items.length > 0 && !confirmingSubmit && (
        <button
          type="button"
          className="w-full flex items-center justify-center gap-1.5 rounded border border-teal bg-teal px-3.5 py-2.5 text-[13px] font-bold text-navy cursor-pointer"
          onClick={() => setConfirmingSubmit(true)}
        >
          <Send size={14} /> Enviar lote
        </button>
      )}

      {confirmingSubmit && (
        <div className="bg-surface border border-rule rounded-md p-4">
          <div className="font-display font-bold text-[14px] mb-3">¿Estás seguro que ingresaste bien detallada la información?</div>
          <div className="flex gap-2">
            <button type="button" className="flex-1 rounded border border-rule px-3 py-2 text-[12.5px] font-semibold cursor-pointer" onClick={() => setConfirmingSubmit(false)}>
              Revisar de nuevo
            </button>
            <button type="button" disabled={submitting} className="flex-1 rounded border border-teal bg-teal px-3 py-2 text-[12.5px] font-bold text-navy cursor-pointer disabled:opacity-60" onClick={submitBatch}>
              {submitting ? "Enviando…" : "Sí, enviar lote"}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

function AddItemForm({ batchId, onAdded, onCancel }: { batchId: string; onAdded: () => void; onCancel: () => void }) {
  const [photoUrl, setPhotoUrl] = useState<string | null>(null);
  const [taking, setTaking] = useState(false);
  const [recognizing, setRecognizing] = useState(false);
  const [match, setMatch] = useState<{ id: string; name: string; photos: string[] } | null | undefined>(undefined);
  const [matchConfirmed, setMatchConfirmed] = useState(false);
  const [manualName, setManualName] = useState("");
  const [goodQty, setGoodQty] = useState("");
  const [damagedQty, setDamagedQty] = useState("");
  const [damageReason, setDamageReason] = useState("");
  const [damageReasonOther, setDamageReasonOther] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  async function onCaptured(url: string) {
    setPhotoUrl(url);
    setTaking(false);
    setRecognizing(true);
    setMatch(undefined);
    setMatchConfirmed(false);
    try {
      const res = await fetch("/api/merchandise-reentry/recognize", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ photoUrl: url }),
      });
      const data = await res.json();
      setMatch(data.catalogItem ?? null);
    } catch {
      setMatch(null);
    } finally {
      setRecognizing(false);
    }
  }

  const dQty = Number(damagedQty) || 0;
  const gQty = Number(goodQty) || 0;
  const hasName = (match && matchConfirmed) || manualName.trim().length > 0;
  const hasDamageReason = dQty === 0 || !!damageReason;
  const canSave = !!photoUrl && hasName && gQty + dQty > 0 && hasDamageReason && !saving;

  async function save() {
    if (!photoUrl) return;
    setSaving(true);
    setError("");
    try {
      await postJson(`/api/merchandise-reentry/batches/${batchId}/items`, {
        photoUrls: [photoUrl],
        catalogItemId: match && matchConfirmed ? match.id : undefined,
        aiRecognized: !!(match && matchConfirmed),
        declaredName: match && matchConfirmed ? undefined : manualName.trim(),
        goodQty: gQty,
        damagedQty: dQty,
        damageReasonName: dQty > 0 ? damageReason : undefined,
        damageReasonOther: dQty > 0 && damageReason === "Otro" ? damageReasonOther.trim() : undefined,
      });
      onAdded();
    } catch (e) {
      setError(e instanceof Error ? e.message : "No se pudo guardar el producto.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="bg-surface border border-rule rounded-md p-3.5 flex flex-col gap-3.5 mb-2.5">
      <div>
        <label className="block mb-1.5 text-[10px] font-semibold uppercase tracking-wide text-steel">1 · Foto del producto</label>
        {photoUrl ? (
          <div className="flex items-center gap-2">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={photoUrl} alt="Foto del producto" className="w-20 h-20 object-cover rounded-md border border-rule" />
            <button type="button" className="text-[11.5px] text-blue font-semibold cursor-pointer" onClick={() => { setPhotoUrl(null); setTaking(true); }}>
              Volver a tomar
            </button>
          </div>
        ) : taking ? (
          <LiveCameraCapture folder="merchandise-reentry-photos" onCaptured={onCaptured} onCancel={() => setTaking(false)} />
        ) : (
          <button type="button" className="flex items-center gap-1.5 text-[12.5px] font-bold border-[1.5px] border-rule rounded-md px-3.5 py-2 cursor-pointer" onClick={() => setTaking(true)}>
            <Camera size={14} /> Tomar foto en vivo
          </button>
        )}
        <div className="text-[10.5px] text-steel mt-1.5">Solo cámara en vivo — no se permite subir fotos guardadas.</div>
      </div>

      {photoUrl && (
        <div>
          <label className="block mb-1.5 text-[10px] font-semibold uppercase tracking-wide text-steel">2 · Producto</label>
          {recognizing ? (
            <div className="text-[12px] text-steel">Comparando con el catálogo…</div>
          ) : match && !manualName ? (
            matchConfirmed ? (
              <div className="flex items-center gap-2.5 bg-green/10 border border-green/35 rounded-md p-2.5">
                {match.photos[0] && (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img src={match.photos[0]} alt={match.name} className="w-10 h-10 object-cover rounded border border-rule shrink-0" />
                )}
                <div className="flex-1 min-w-0 text-[12.5px] font-semibold truncate">{match.name}</div>
                <Check size={16} className="text-green shrink-0" />
              </div>
            ) : (
              <div className="flex items-center gap-2.5 bg-green/10 border border-green/35 rounded-md p-2.5">
                {match.photos[0] && (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img src={match.photos[0]} alt={match.name} className="w-10 h-10 object-cover rounded border border-rule shrink-0" />
                )}
                <div className="flex-1 min-w-0">
                  <div className="text-[9px] font-bold uppercase tracking-wide text-green mb-0.5">Reconocido por IA</div>
                  <div className="text-[12.5px] font-semibold truncate">{match.name}</div>
                </div>
                <button type="button" className="shrink-0 rounded border border-green bg-green px-2.5 py-1.5 text-[11px] font-bold text-white cursor-pointer" onClick={() => setMatchConfirmed(true)}>
                  Confirmar
                </button>
              </div>
            )
          ) : (
            <div>
              {match === null && <div className="text-[11.5px] text-steel mb-1.5">La IA no reconoció este producto.</div>}
              <input
                type="text"
                placeholder="Nombre de referencia (lo más cercano posible)"
                className="w-full rounded border border-rule bg-cloud px-2.5 py-2 text-[12.5px]"
                value={manualName}
                onChange={(e) => setManualName(e.target.value)}
              />
            </div>
          )}
          {match && !matchConfirmed && !manualName && (
            <button type="button" className="text-[11px] text-blue font-semibold cursor-pointer mt-1.5" onClick={() => setMatch(null)}>
              No es este producto — poner nombre a mano
            </button>
          )}
        </div>
      )}

      {photoUrl && (
        <div>
          <label className="block mb-1.5 text-[10px] font-semibold uppercase tracking-wide text-steel">3 · Cantidades</label>
          <div className="flex gap-2.5">
            <div className="flex-1">
              <div className="text-[11px] text-steel mb-1">Unidades buenas</div>
              <input type="number" min={0} className="w-full rounded border border-rule bg-cloud px-2.5 py-1.5 text-[13px] font-bold text-green" value={goodQty} onChange={(e) => setGoodQty(e.target.value)} />
            </div>
            <div className="flex-1">
              <div className="text-[11px] text-steel mb-1">Unidades dañadas</div>
              <input type="number" min={0} className="w-full rounded border border-rule bg-cloud px-2.5 py-1.5 text-[13px] font-bold text-red" value={damagedQty} onChange={(e) => setDamagedQty(e.target.value)} />
            </div>
          </div>

          {dQty > 0 && (
            <div className="mt-2.5">
              <div className="text-[11px] text-steel mb-1.5">Motivo del daño</div>
              <div className="flex gap-1.5 flex-wrap">
                {DAMAGE_REASONS.map((r) => (
                  <button
                    key={r}
                    type="button"
                    onClick={() => setDamageReason(r)}
                    className={`text-[11.5px] font-semibold rounded-full px-2.5 py-1 border cursor-pointer ${damageReason === r ? "border-teal text-teal bg-teal/15" : "border-rule text-steel"}`}
                  >
                    {r}
                  </button>
                ))}
              </div>
              {damageReason === "Otro" && (
                <input
                  type="text"
                  placeholder="Describe el motivo"
                  className="w-full mt-1.5 rounded border border-rule bg-cloud px-2.5 py-1.5 text-[12px]"
                  value={damageReasonOther}
                  onChange={(e) => setDamageReasonOther(e.target.value)}
                />
              )}
            </div>
          )}
        </div>
      )}

      {error && <div className="text-red text-[11.5px]">{error}</div>}

      <div className="flex gap-2">
        <button type="button" className="flex-1 rounded border border-rule px-3 py-2 text-[12px] font-semibold cursor-pointer" onClick={onCancel}>
          Cancelar
        </button>
        <button type="button" disabled={!canSave} className="flex-1 rounded border border-teal bg-teal px-3 py-2 text-[12px] font-bold text-navy cursor-pointer disabled:opacity-40" onClick={save}>
          {saving ? "Guardando…" : "Agregar al lote"}
        </button>
      </div>
    </div>
  );
}
