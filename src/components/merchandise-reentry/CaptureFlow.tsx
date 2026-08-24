"use client";

import { useEffect, useState } from "react";
import { Camera, Check, Pencil, Plus, Send, Trash2, X } from "lucide-react";
import { LiveCameraCapture } from "@/components/shared/LiveCameraCapture";
import { ProductMatchPicker, type MatchCatalogItem, type ProductMatchResult } from "./ProductMatchPicker";

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
  const [confirmDeleteItemId, setConfirmDeleteItemId] = useState<string | null>(null);
  const [deletingItem, setDeletingItem] = useState(false);
  const [confirmDeleteBatch, setConfirmDeleteBatch] = useState(false);
  const [deletingBatch, setDeletingBatch] = useState(false);
  // Confirmado 2026-08-23 (pedido explícito del usuario): mientras el lote
  // sigue en borrador, cualquier producto ya agregado se puede desvincular y
  // volver a vincular las veces que haga falta — no solo elegir bien la
  // primera vez.
  const [editingItemId, setEditingItemId] = useState<string | null>(null);
  const [relinkError, setRelinkError] = useState("");

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

  async function deleteItem(itemId: string) {
    setDeletingItem(true);
    try {
      await fetch(`/api/merchandise-reentry/items/${itemId}`, { method: "DELETE" });
      setConfirmDeleteItemId(null);
      loadDraft();
    } finally {
      setDeletingItem(false);
    }
  }

  async function relinkItem(itemId: string, result: ProductMatchResult) {
    setRelinkError("");
    try {
      await postJson(`/api/merchandise-reentry/items/${itemId}/relink`, "catalogItem" in result ? { catalogItemId: result.catalogItem.id } : { manualName: result.manualName });
      setEditingItemId(null);
      loadDraft();
    } catch (e) {
      setRelinkError(e instanceof Error ? e.message : "No se pudo cambiar el producto.");
    }
  }

  async function deleteBatch() {
    if (!batch) return;
    setDeletingBatch(true);
    try {
      await fetch(`/api/merchandise-reentry/batches/${batch.id}`, { method: "DELETE" });
      setBatch(null);
      setConfirmDeleteBatch(false);
    } finally {
      setDeletingBatch(false);
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
      <div className="flex items-center justify-between gap-2 mb-3">
        <div className="flex items-center gap-2">
          <span className="font-mono text-[11px] font-bold text-teal">{batch.code}</span>
          <span className="font-mono text-[10px] text-steel bg-cloud rounded-full px-2 py-0.5">{batch.items.length} producto(s) agregados</span>
        </div>
        {!adding && !confirmingSubmit && !confirmDeleteBatch && (
          <button type="button" className="flex items-center gap-1 text-[11px] font-semibold text-steel hover:text-red cursor-pointer" onClick={() => setConfirmDeleteBatch(true)}>
            <Trash2 size={12} /> Cancelar lote
          </button>
        )}
      </div>

      {confirmDeleteBatch && (
        <div className="bg-red/10 border border-red/40 rounded-md p-3.5 mb-3">
          <div className="font-display font-bold text-[13.5px] mb-1">¿Eliminar todo el lote {batch.code}?</div>
          <p className="text-[12px] text-steel mb-3">Se van a borrar los {batch.items.length} producto(s) agregados. Esto no se puede deshacer.</p>
          <div className="flex gap-2">
            <button type="button" className="flex-1 rounded border border-rule px-3 py-2 text-[12px] font-semibold cursor-pointer" onClick={() => setConfirmDeleteBatch(false)}>
              No, mantener lote
            </button>
            <button type="button" disabled={deletingBatch} className="flex-1 rounded border border-red bg-red px-3 py-2 text-[12px] font-bold text-white cursor-pointer disabled:opacity-60" onClick={deleteBatch}>
              {deletingBatch ? "Eliminando…" : "Sí, eliminar lote"}
            </button>
          </div>
        </div>
      )}

      <div className="flex flex-col gap-2 mb-3">
        {batch.items.map((item) =>
          confirmDeleteItemId === item.id ? (
            <div key={item.id} className="bg-red/10 border border-red/40 rounded-md p-3">
              <div className="text-[12.5px] font-semibold mb-2">¿Eliminar &quot;{itemName(item)}&quot; del lote?</div>
              <div className="flex gap-2">
                <button type="button" className="flex-1 rounded border border-rule px-3 py-1.5 text-[11.5px] font-semibold cursor-pointer" onClick={() => setConfirmDeleteItemId(null)}>
                  Cancelar
                </button>
                <button
                  type="button"
                  disabled={deletingItem}
                  className="flex-1 rounded border border-red bg-red px-3 py-1.5 text-[11.5px] font-bold text-white cursor-pointer disabled:opacity-60"
                  onClick={() => deleteItem(item.id)}
                >
                  {deletingItem ? "Eliminando…" : "Sí, eliminar"}
                </button>
              </div>
            </div>
          ) : (
            <div key={item.id} className="bg-surface border border-rule rounded-md p-3">
              <div className="flex items-center gap-3">
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
                  title="Cambiar el producto vinculado"
                  className="text-steel hover:text-teal cursor-pointer shrink-0"
                  onClick={() => { setEditingItemId(editingItemId === item.id ? null : item.id); setRelinkError(""); }}
                >
                  <Pencil size={14} />
                </button>
                <button
                  type="button"
                  className="text-steel hover:text-red cursor-pointer shrink-0"
                  onClick={() => setConfirmDeleteItemId(item.id)}
                >
                  <X size={14} />
                </button>
              </div>
              {editingItemId === item.id && (
                <div className="mt-2.5">
                  <ProductMatchPicker referencePhotoUrl={item.photoUrls[0] ?? null} onConfirm={(r) => relinkItem(item.id, r)} onCancel={() => setEditingItemId(null)} />
                  {relinkError && <div className="text-red text-[11.5px] mt-1.5">{relinkError}</div>}
                </div>
              )}
            </div>
          )
        )}
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

// Confirmado 2026-08-20: pedido explícito del usuario — se sacó el
// reconocimiento por IA (tenía un costo real por cada foto). Ahora se
// busca a mano contra el catálogo ya cargado, vía ProductMatchPicker
// (mismo componente compartido con la edición de un producto ya agregado y
// con la re-vinculación de Daniel en Revisión).
function AddItemForm({ batchId, onAdded, onCancel }: { batchId: string; onAdded: () => void; onCancel: () => void }) {
  const [photoUrl, setPhotoUrl] = useState<string | null>(null);
  const [photoUrl2, setPhotoUrl2] = useState<string | null>(null);
  const [taking, setTaking] = useState(false);
  const [taking2, setTaking2] = useState(false);

  const [selected, setSelected] = useState<MatchCatalogItem | null>(null);
  const [manualName, setManualName] = useState("");

  const [goodQty, setGoodQty] = useState("");
  const [damagedQty, setDamagedQty] = useState("");
  const [damageReason, setDamageReason] = useState("");
  const [damageReasonOther, setDamageReasonOther] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [confirmingAdd, setConfirmingAdd] = useState(false);

  function onCaptured(url: string) {
    setPhotoUrl(url);
    setTaking(false);
  }

  function onCaptured2(url: string) {
    setPhotoUrl2(url);
    setTaking2(false);
  }

  function onMatchConfirmed(result: ProductMatchResult) {
    if ("catalogItem" in result) {
      setSelected(result.catalogItem);
      setManualName("");
    } else {
      setManualName(result.manualName);
      setSelected(null);
    }
  }

  const dQty = Number(damagedQty) || 0;
  const gQty = Number(goodQty) || 0;
  const hasName = !!selected || manualName.trim().length > 0;
  const hasDamageReason = dQty === 0 || !!damageReason;
  const canSave = !!photoUrl && hasName && gQty + dQty > 0 && hasDamageReason && !saving;
  const finalName = selected ? selected.name : manualName.trim();
  const finalDamageReason = dQty > 0 ? (damageReason === "Otro" ? damageReasonOther.trim() || "Otro (sin describir)" : damageReason) : null;

  async function save() {
    if (!photoUrl) return;
    setSaving(true);
    setError("");
    try {
      await postJson(`/api/merchandise-reentry/batches/${batchId}/items`, {
        photoUrls: photoUrl2 ? [photoUrl, photoUrl2] : [photoUrl],
        catalogItemId: selected ? selected.id : undefined,
        aiRecognized: !!selected,
        declaredName: selected ? undefined : manualName.trim(),
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
      {confirmingAdd ? (
        <div>
          <div className="font-display font-bold text-[14px] mb-2.5">Revisa antes de agregar</div>
          <div className="flex items-center gap-2 mb-3">
            {photoUrl && (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={photoUrl} alt="Foto del producto" className="w-16 h-16 object-cover rounded-md border border-rule" />
            )}
            {photoUrl2 && (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={photoUrl2} alt="Segunda foto del producto" className="w-16 h-16 object-cover rounded-md border border-rule" />
            )}
          </div>
          <div className="flex flex-col gap-2 text-[12.5px]">
            <div className="flex items-start justify-between gap-3">
              <span className="text-steel shrink-0">Producto</span>
              <span className="font-semibold text-right">{finalName}</span>
            </div>
            {!selected && (
              <div className="text-[11px] text-steel -mt-1">Nombre puesto a mano — no se encontró en el catálogo o se prefirió escribir directo.</div>
            )}
            <div className="flex items-start justify-between gap-3">
              <span className="text-steel shrink-0">Unidades buenas</span>
              <span className="font-semibold text-green">{gQty}</span>
            </div>
            <div className="flex items-start justify-between gap-3">
              <span className="text-steel shrink-0">Unidades dañadas</span>
              <span className="font-semibold text-red">{dQty}</span>
            </div>
            {finalDamageReason && (
              <div className="flex items-start justify-between gap-3">
                <span className="text-steel shrink-0">Motivo del daño</span>
                <span className="font-semibold text-right">{finalDamageReason}</span>
              </div>
            )}
          </div>
          <p className="text-[11.5px] text-steel mt-3">¿Está bien detallada esta información? Una vez agregada al lote, cualquier corrección la tendrá que hacer Daniel al revisar.</p>
          {error && <div className="text-red text-[11.5px] mt-2">{error}</div>}
          <div className="flex gap-2 mt-3">
            <button type="button" className="flex-1 rounded border border-rule px-3 py-2 text-[12px] font-semibold cursor-pointer" onClick={() => setConfirmingAdd(false)}>
              Revisar de nuevo
            </button>
            <button type="button" disabled={saving} className="flex-1 rounded border border-teal bg-teal px-3 py-2 text-[12px] font-bold text-navy cursor-pointer disabled:opacity-60" onClick={save}>
              {saving ? "Guardando…" : "Sí, agregar al lote"}
            </button>
          </div>
        </div>
      ) : (
        <>
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
          <label className="block mb-1.5 text-[10px] font-semibold uppercase tracking-wide text-steel">2 · Segunda foto (opcional)</label>
          {photoUrl2 ? (
            <div className="flex items-center gap-2">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={photoUrl2} alt="Segunda foto del producto" className="w-20 h-20 object-cover rounded-md border border-rule" />
              <div className="flex flex-col items-start gap-1">
                <button type="button" className="text-[11.5px] text-blue font-semibold cursor-pointer" onClick={() => { setPhotoUrl2(null); setTaking2(true); }}>
                  Volver a tomar
                </button>
                <button type="button" className="text-[11.5px] text-steel font-semibold cursor-pointer" onClick={() => setPhotoUrl2(null)}>
                  Quitar
                </button>
              </div>
            </div>
          ) : taking2 ? (
            <LiveCameraCapture folder="merchandise-reentry-photos" onCaptured={onCaptured2} onCancel={() => setTaking2(false)} />
          ) : (
            <button type="button" className="flex items-center gap-1.5 text-[12.5px] font-semibold border-[1.5px] border-dashed border-rule rounded-md px-3.5 py-2 cursor-pointer" onClick={() => setTaking2(true)}>
              <Camera size={14} /> Agregar segunda foto
            </button>
          )}
          <div className="text-[10.5px] text-steel mt-1.5">Útil como evidencia extra, por ejemplo si son varias unidades del mismo producto.</div>
        </div>
      )}

      {photoUrl && (
        <div>
          <label className="block mb-1.5 text-[10px] font-semibold uppercase tracking-wide text-steel">3 · Producto</label>
          {selected ? (
            <div className="flex flex-col gap-2">
              <div className="text-[10px] font-semibold uppercase tracking-wide text-steel">Tu foto vs. la del catálogo</div>
              <div className="flex items-center gap-2.5">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={photoUrl} alt="Foto tomada" className="w-16 h-16 object-cover rounded-md border border-rule" />
                {selected.photos[0] && (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img src={selected.photos[0]} alt={selected.name} className="w-16 h-16 object-cover rounded-md border border-green/40" />
                )}
              </div>
              <div className="flex items-center gap-2.5 bg-green/10 border border-green/35 rounded-md p-2.5">
                <div className="flex-1 min-w-0 text-[12.5px] font-semibold truncate">{selected.name}</div>
                <button type="button" className="shrink-0 text-[11px] font-semibold text-blue cursor-pointer" onClick={() => setSelected(null)}>
                  Cambiar
                </button>
              </div>
            </div>
          ) : manualName ? (
            <div className="flex items-center gap-2.5 bg-cloud rounded-md p-2.5">
              <div className="flex-1 min-w-0 text-[12.5px] font-medium truncate">{manualName}</div>
              <button type="button" className="shrink-0 text-[11px] font-semibold text-blue cursor-pointer" onClick={() => setManualName("")}>
                Cambiar
              </button>
            </div>
          ) : (
            <ProductMatchPicker referencePhotoUrl={photoUrl} onConfirm={onMatchConfirmed} />
          )}
        </div>
      )}

      {photoUrl && (
        <div>
          <label className="block mb-1.5 text-[10px] font-semibold uppercase tracking-wide text-steel">4 · Cantidades</label>
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
        <button type="button" disabled={!canSave} className="flex-1 rounded border border-teal bg-teal px-3 py-2 text-[12px] font-bold text-navy cursor-pointer disabled:opacity-40" onClick={() => setConfirmingAdd(true)}>
          Agregar al lote
        </button>
      </div>
      </>
      )}
    </div>
  );
}
