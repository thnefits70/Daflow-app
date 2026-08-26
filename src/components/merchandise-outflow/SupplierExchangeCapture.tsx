"use client";

import { useEffect, useRef, useState } from "react";
import { Camera, Check, ExternalLink, Plus, Search, Send, Trash2, Upload, X } from "lucide-react";
import { LiveCameraCapture } from "@/components/shared/LiveCameraCapture";
import { ProductMatchPicker, type MatchCatalogItem, type ProductMatchResult } from "@/components/merchandise-reentry/ProductMatchPicker";
import { compressImage } from "@/lib/compressImage";
import { uploadFile } from "@/lib/uploadFile";

type SupplierOption = { id: string; name: string };

type ItemDTO = {
  id: string;
  declaredName: string;
  quantity: number;
  catalogItem: { name: string; photos: string[] } | null;
  unitCostAtExchange: number | null;
  expectedCreditAmount: number | null;
  linkedPurchaseRequest: { requestNumber: number | null; requestedAt: string; requestedBy: { name: string } | null } | null;
};

type BatchDTO = { id: string; code: string; documentPhotoUrls: string[]; supplier: SupplierOption | null; items: ItemDTO[] };

const MAX_PHOTOS = 20;

async function postJson(url: string, body?: unknown) {
  const res = await fetch(url, { method: "POST", headers: { "Content-Type": "application/json" }, body: body ? JSON.stringify(body) : undefined });
  const data = await res.json().catch(() => null);
  if (!res.ok) throw new Error(data?.error ?? "Ocurrió un error.");
  return data;
}

function itemName(item: ItemDTO) {
  return item.catalogItem?.name ?? item.declaredName;
}

function money(n: number) {
  return `$${n.toFixed(2)}`;
}

// Daniel manda mercadería YA registrada en Just de vuelta a un proveedor
// para cambio — pedido explícito del usuario 2026-08-26: varios productos
// por solicitud (antes era uno por uno), con fotos de la lista física como
// evidencia. Cada producto vinculado al catálogo se cruza solo contra la
// última compra REAL a ese mismo proveedor (ver findMostRecentSupplierPurchase
// en merchandiseOutflow.ts) para dejar estimado el crédito reclamable si el
// proveedor no cambia el producto.
export function SupplierExchangeCapture({ onSent }: { onSent?: () => void }) {
  const [loading, setLoading] = useState(true);
  const [batch, setBatch] = useState<BatchDTO | null>(null);
  const [error, setError] = useState("");
  const [adding, setAdding] = useState(false);
  const [taking, setTaking] = useState(false);
  const [uploadingPhoto, setUploadingPhoto] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [confirmingSubmit, setConfirmingSubmit] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [sentCode, setSentCode] = useState<string | null>(null);
  const [sentBatchId, setSentBatchId] = useState<string | null>(null);
  const [confirmDeleteItemId, setConfirmDeleteItemId] = useState<string | null>(null);
  const [confirmDeleteBatch, setConfirmDeleteBatch] = useState(false);
  const [zoomedPhoto, setZoomedPhoto] = useState<string | null>(null);

  // Búsqueda de proveedor — solo antes de que exista un borrador.
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<SupplierOption[]>([]);
  const [startingSupplier, setStartingSupplier] = useState<SupplierOption | null>(null);
  const [starting, setStarting] = useState(false);

  function loadDraft() {
    fetch("/api/merchandise-outflow/draft?reason=CAMBIO_PROVEEDOR")
      .then((r) => r.json())
      .then((data) => setBatch(data ?? null))
      .catch(() => setBatch(null))
      .finally(() => setLoading(false));
  }

  useEffect(loadDraft, []);

  useEffect(() => {
    if (batch) return;
    const t = setTimeout(() => {
      fetch(`/api/merchandise-outflow/supplier-search?q=${encodeURIComponent(query.trim())}`)
        .then((r) => (r.ok ? r.json() : []))
        .then(setResults)
        .catch(() => null);
    }, 200);
    return () => clearTimeout(t);
  }, [query, batch]);

  async function startBatch() {
    if (!startingSupplier) return;
    setStarting(true);
    setError("");
    try {
      const created = await postJson("/api/merchandise-outflow/draft", { reason: "CAMBIO_PROVEEDOR", supplierId: startingSupplier.id });
      setBatch({ ...created, items: created.items ?? [] });
    } catch (e) {
      setError(e instanceof Error ? e.message : "No se pudo iniciar la solicitud.");
    } finally {
      setStarting(false);
    }
  }

  async function addPhoto(url: string) {
    if (!batch) return;
    setTaking(false);
    const photoUrls = [...batch.documentPhotoUrls, url];
    setBatch({ ...batch, documentPhotoUrls: photoUrls });
    try {
      await postJson(`/api/merchandise-outflow/batches/${batch.id}/photos`, { photoUrls });
    } catch (e) {
      setError(e instanceof Error ? e.message : "No se pudo guardar la foto.");
    }
  }

  // Confirmado 2026-08-26: pedido explícito del usuario — a diferencia del
  // resto de fotos de la app (siempre cámara en vivo, ver LiveCameraCapture),
  // acá SÍ se permite subir una foto ya tomada de la galería. Esta foto es
  // evidencia del paquete/lista completa, no la identificación en vivo de un
  // producto puntual, así que el mismo nivel de control anti-fraude no
  // aplica igual — sigue teniendo que ser una foto real de los productos.
  async function uploadPhotoFile(file: File) {
    setUploadingPhoto(true);
    setError("");
    const compressed = await compressImage(file);
    const result = await uploadFile(compressed, "merchandise-outflow-photos");
    setUploadingPhoto(false);
    if (!result.ok) {
      setError(result.error);
      return;
    }
    await addPhoto(result.url);
  }

  async function removePhoto(index: number) {
    if (!batch) return;
    const photoUrls = batch.documentPhotoUrls.filter((_, i) => i !== index);
    setBatch({ ...batch, documentPhotoUrls: photoUrls });
    await postJson(`/api/merchandise-outflow/batches/${batch.id}/photos`, { photoUrls }).catch(() => null);
  }

  async function deleteItem(itemId: string) {
    if (!batch) return;
    await fetch(`/api/merchandise-outflow/items/${itemId}`, { method: "DELETE" });
    setConfirmDeleteItemId(null);
    loadDraft();
  }

  async function deleteBatch() {
    if (!batch) return;
    await fetch(`/api/merchandise-outflow/batches/${batch.id}`, { method: "DELETE" });
    setBatch(null);
    setConfirmDeleteBatch(false);
  }

  async function submitBatch() {
    if (!batch) return;
    setSubmitting(true);
    setError("");
    try {
      await postJson(`/api/merchandise-outflow/batches/${batch.id}/submit`);
      setSentCode(batch.code);
      setSentBatchId(batch.id);
      setBatch(null);
      setConfirmingSubmit(false);
      onSent?.();
    } catch (e) {
      setError(e instanceof Error ? e.message : "No se pudo enviar la solicitud.");
    } finally {
      setSubmitting(false);
    }
  }

  function reset() {
    setSentCode(null);
    setSentBatchId(null);
    setQuery("");
    setStartingSupplier(null);
    loadDraft();
  }

  if (loading) return <div className="text-[13px] text-steel">Cargando…</div>;

  if (sentCode) {
    return (
      <div className="bg-surface border border-rule rounded-md p-6 max-w-sm text-center">
        <div className="w-11 h-11 rounded-full bg-green/15 border border-green/40 flex items-center justify-center mx-auto mb-3">
          <Check size={20} className="text-green" />
        </div>
        <div className="font-display font-bold text-[15px] mb-1.5">{sentCode} enviado</div>
        <p className="text-[12.5px] text-steel mb-4">
          Ya cayó en la cola de dar de baja en Just, y cada producto queda pendiente de saber si el proveedor lo cambia o da crédito. Anota <b>{sentCode}</b> en el paquete físico.
        </p>
        {sentBatchId && (
          <a
            href={`/cambio-proveedor/${sentBatchId}`}
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex items-center gap-1.5 text-[12.5px] font-bold text-navy bg-teal rounded px-3.5 py-2 mb-3 cursor-pointer"
          >
            <ExternalLink size={13} /> Ver / imprimir guía
          </a>
        )}
        <div>
          <button type="button" className="text-[12.5px] font-bold text-teal cursor-pointer" onClick={reset}>
            Registrar otra solicitud
          </button>
        </div>
      </div>
    );
  }

  if (!batch) {
    return (
      <div className="bg-surface border border-rule rounded-md p-3.5 max-w-sm">
        <label className="block mb-1.5 text-[10px] font-semibold uppercase tracking-wide text-steel">Proveedor</label>
        {startingSupplier ? (
          <div className="flex items-center gap-2.5 bg-green/10 border border-green/35 rounded-md p-2.5 mb-3">
            <div className="flex-1 min-w-0 text-[12.5px] font-semibold truncate">{startingSupplier.name}</div>
            <button type="button" className="shrink-0 text-[11px] font-semibold text-blue cursor-pointer" onClick={() => setStartingSupplier(null)}>
              Cambiar
            </button>
          </div>
        ) : (
          <div className="bg-cloud rounded-md p-3 mb-3">
            <div className="flex items-center gap-1.5 rounded border border-rule bg-surface px-2.5 py-2">
              <Search size={13} className="text-steel" />
              <input type="text" autoFocus placeholder="Buscá el proveedor…" className="flex-1 text-[12.5px] outline-none bg-transparent" value={query} onChange={(e) => setQuery(e.target.value)} />
            </div>
            {results.length > 0 && (
              <div className="flex flex-col gap-1 mt-1.5 border border-rule rounded-md overflow-hidden">
                {results.map((s) => (
                  <button key={s.id} type="button" className="text-left p-2 text-[12.5px] font-medium hover:bg-surface cursor-pointer" onClick={() => setStartingSupplier(s)}>
                    {s.name}
                  </button>
                ))}
              </div>
            )}
            {query.trim().length > 0 && results.length === 0 && <div className="text-[11.5px] text-steel mt-1">No se encontró ningún proveedor con ese nombre.</div>}
          </div>
        )}
        {error && <div className="text-red text-[11.5px] mb-2">{error}</div>}
        <button type="button" disabled={!startingSupplier || starting} className="w-full rounded border border-teal bg-teal px-3.5 py-2.5 text-[13px] font-bold text-navy cursor-pointer disabled:opacity-40" onClick={startBatch}>
          {starting ? "Iniciando…" : "Empezar solicitud"}
        </button>
      </div>
    );
  }

  const canSubmit = batch.items.length > 0 && batch.documentPhotoUrls.length > 0;

  return (
    <div className="max-w-md">
      <div className="flex items-center justify-between gap-2 mb-3">
        <div className="flex items-center gap-2 flex-wrap">
          <span className="font-mono text-[11px] font-bold text-teal">{batch.code}</span>
          <span className="text-[12px] font-semibold">{batch.supplier?.name}</span>
          <span className="font-mono text-[10px] text-steel bg-cloud rounded-full px-2 py-0.5">{batch.items.length} producto(s)</span>
        </div>
        {!confirmDeleteBatch && (
          <button type="button" className="flex items-center gap-1 text-[11px] font-semibold text-steel hover:text-red cursor-pointer" onClick={() => setConfirmDeleteBatch(true)}>
            <Trash2 size={12} /> Cancelar solicitud
          </button>
        )}
      </div>

      {confirmDeleteBatch && (
        <div className="bg-red/10 border border-red/40 rounded-md p-3.5 mb-3">
          <div className="font-display font-bold text-[13.5px] mb-1">¿Eliminar toda la solicitud {batch.code}?</div>
          <p className="text-[12px] text-steel mb-3">Se van a borrar los {batch.items.length} producto(s) agregados. Esto no se puede deshacer.</p>
          <div className="flex gap-2">
            <button type="button" className="flex-1 rounded border border-rule px-3 py-2 text-[12px] font-semibold cursor-pointer" onClick={() => setConfirmDeleteBatch(false)}>
              No, mantener
            </button>
            <button type="button" className="flex-1 rounded border border-red bg-red px-3 py-2 text-[12px] font-bold text-white cursor-pointer" onClick={deleteBatch}>
              Sí, eliminar
            </button>
          </div>
        </div>
      )}

      {batch.items.length > 0 && (
        <div className="flex flex-col gap-2 mb-3">
          {batch.items.map((item) =>
            confirmDeleteItemId === item.id ? (
              <div key={item.id} className="bg-red/10 border border-red/40 rounded-md p-2.5 flex items-center justify-between gap-2">
                <span className="text-[12px]">¿Quitar &quot;{itemName(item)}&quot;?</span>
                <div className="flex gap-1.5 shrink-0">
                  <button type="button" className="text-[11px] font-semibold cursor-pointer" onClick={() => setConfirmDeleteItemId(null)}>Cancelar</button>
                  <button type="button" className="text-[11px] font-bold text-red cursor-pointer" onClick={() => deleteItem(item.id)}>Sí, quitar</button>
                </div>
              </div>
            ) : (
              <div key={item.id} className="bg-surface border border-rule rounded-md p-2.5">
                <div className="flex items-center gap-2.5">
                  {item.catalogItem?.photos[0] && (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img src={item.catalogItem.photos[0]} alt={itemName(item)} className="w-10 h-10 object-cover rounded border border-rule shrink-0 cursor-zoom-in" onClick={() => setZoomedPhoto(item.catalogItem!.photos[0])} />
                  )}
                  <div className="flex-1 min-w-0 flex items-center justify-between gap-2">
                    <span className="text-[12.5px] font-semibold truncate">{itemName(item)}</span>
                    <div className="flex items-center gap-2 shrink-0">
                      <span className="font-mono text-[11px] text-steel">{item.quantity} un.</span>
                      <button type="button" className="text-steel hover:text-red cursor-pointer" onClick={() => setConfirmDeleteItemId(item.id)}>
                        <X size={13} />
                      </button>
                    </div>
                  </div>
                </div>
                {item.expectedCreditAmount !== null ? (
                  <div className="text-[11px] text-steel mt-1">
                    Costo pagado: <span className="font-semibold text-ink">{money(item.unitCostAtExchange!)}/un.</span> · crédito estimado si no hay cambio:{" "}
                    <span className="font-semibold text-blue">{money(item.expectedCreditAmount)}</span>
                  </div>
                ) : (
                  <div className="text-[11px] text-steel mt-1">Sin historial de compra a este proveedor por este producto.</div>
                )}
              </div>
            )
          )}
        </div>
      )}

      {error && <div className="text-red text-[12px] mb-2">{error}</div>}

      {adding ? (
        <AddItemForm batchId={batch.id} onAdded={() => { setAdding(false); loadDraft(); }} onCancel={() => setAdding(false)} />
      ) : (
        <button
          type="button"
          className="w-full flex items-center justify-center gap-1.5 rounded-md border-[1.5px] border-dashed border-rule px-3.5 py-2.5 text-[12.5px] font-semibold cursor-pointer hover:border-teal mb-3"
          onClick={() => setAdding(true)}
        >
          <Plus size={14} /> Agregar producto a la solicitud
        </button>
      )}

      <div className="bg-surface border border-rule rounded-md p-3.5 mb-3">
        <label className="block mb-1.5 text-[10px] font-semibold uppercase tracking-wide text-steel">Fotos de la lista física declarada</label>
        <div className="flex gap-2 flex-wrap mb-2">
          {batch.documentPhotoUrls.map((p, i) => (
            <div key={i} className="relative">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={p} alt={`Foto ${i + 1}`} className="w-16 h-16 object-cover rounded border border-rule cursor-zoom-in" onClick={() => setZoomedPhoto(p)} />
              <button type="button" title="Quitar esta foto" className="absolute -top-1.5 -right-1.5 w-5 h-5 rounded-full bg-red text-white flex items-center justify-center cursor-pointer" onClick={() => removePhoto(i)}>
                <X size={11} />
              </button>
            </div>
          ))}
        </div>
        {taking ? (
          <LiveCameraCapture folder="merchandise-outflow-photos" onCaptured={addPhoto} onCancel={() => setTaking(false)} />
        ) : batch.documentPhotoUrls.length >= MAX_PHOTOS ? (
          <div className="text-[11.5px] text-steel">Máximo {MAX_PHOTOS} fotos.</div>
        ) : (
          <div className="flex items-center gap-2 flex-wrap">
            <button type="button" className="flex items-center gap-1.5 text-[12.5px] font-bold border-[1.5px] border-rule rounded-md px-3.5 py-2 cursor-pointer" onClick={() => setTaking(true)}>
              <Camera size={14} /> {batch.documentPhotoUrls.length === 0 ? "Tomar foto de la lista" : "Agregar otra foto"}
            </button>
            <input
              ref={fileInputRef}
              type="file"
              accept="image/*"
              className="hidden"
              onChange={(e) => { const f = e.target.files?.[0]; if (f) uploadPhotoFile(f); e.target.value = ""; }}
            />
            <button
              type="button"
              disabled={uploadingPhoto}
              className="flex items-center gap-1.5 text-[12.5px] font-semibold text-blue cursor-pointer disabled:opacity-60"
              onClick={() => fileInputRef.current?.click()}
            >
              <Upload size={13} /> {uploadingPhoto ? "Subiendo…" : "Subir foto guardada"}
            </button>
          </div>
        )}
        <div className="text-[10.5px] text-steel mt-1.5">Evidencia de qué productos declaraste para el cambio — se pega junto con el paquete físico. Puede ser una foto tomada en el momento o una ya guardada, siempre que muestre los productos reales.</div>
      </div>

      {!confirmingSubmit && (
        <button
          type="button"
          disabled={!canSubmit}
          title={!canSubmit ? "Agrega al menos un producto y una foto de la lista" : undefined}
          className="w-full flex items-center justify-center gap-1.5 rounded border border-teal bg-teal px-3.5 py-2.5 text-[13px] font-bold text-navy cursor-pointer disabled:opacity-40"
          onClick={() => setConfirmingSubmit(true)}
        >
          <Send size={14} /> Dejar lista la solicitud
        </button>
      )}
      {confirmingSubmit && (
        <div className="bg-surface border border-rule rounded-md p-4">
          <div className="font-display font-bold text-[14px] mb-3">¿Ya está completa la lista de productos y la foto de evidencia?</div>
          <p className="text-[11.5px] text-steel mb-3">Esto se registra como que la mercadería YA salió de Just — confirmá que de verdad vas a mandar el paquete.</p>
          <div className="flex gap-2">
            <button type="button" className="flex-1 rounded border border-rule px-3 py-2 text-[12.5px] font-semibold cursor-pointer" onClick={() => setConfirmingSubmit(false)}>Revisar de nuevo</button>
            <button type="button" disabled={submitting} className="flex-1 rounded border border-teal bg-teal px-3 py-2 text-[12.5px] font-bold text-navy cursor-pointer disabled:opacity-60" onClick={submitBatch}>
              {submitting ? "Enviando…" : "Sí, dejar lista"}
            </button>
          </div>
        </div>
      )}

      {zoomedPhoto && (
        <div className="fixed inset-0 z-50 bg-black/80 flex items-center justify-center cursor-zoom-out p-6" onClick={() => setZoomedPhoto(null)}>
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={zoomedPhoto} alt="" className="max-w-[90vw] max-h-[90vh] object-contain rounded-md shadow-2xl" onClick={(e) => e.stopPropagation()} />
        </div>
      )}
    </div>
  );
}

function AddItemForm({ batchId, onAdded, onCancel }: { batchId: string; onAdded: () => void; onCancel: () => void }) {
  const [selected, setSelected] = useState<MatchCatalogItem | null>(null);
  const [manualName, setManualName] = useState("");
  const [quantity, setQuantity] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  const qty = Number(quantity) || 0;
  const hasName = !!selected || manualName.trim().length > 0;
  const canSave = hasName && qty > 0 && !saving;

  async function save() {
    setSaving(true);
    setError("");
    try {
      await postJson(`/api/merchandise-outflow/batches/${batchId}/items`, {
        catalogItemId: selected?.id,
        declaredName: selected ? undefined : manualName.trim(),
        quantity: qty,
      });
      onAdded();
    } catch (e) {
      setError(e instanceof Error ? e.message : "No se pudo agregar el producto.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="bg-cloud rounded-md p-3 mb-3">
      <div>
        <label className="block mb-1.5 text-[10px] font-semibold uppercase tracking-wide text-steel">Producto</label>
        {selected ? (
          <div className="flex items-center gap-2.5 bg-green/10 border border-green/35 rounded-md p-2.5">
            {selected.photos[0] && (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={selected.photos[0]} alt={selected.name} className="w-10 h-10 object-cover rounded border border-green/40 shrink-0" />
            )}
            <div className="flex-1 min-w-0 text-[12.5px] font-semibold truncate">{selected.name}</div>
            <button type="button" className="shrink-0 text-[11px] font-semibold text-blue cursor-pointer" onClick={() => setSelected(null)}>Cambiar</button>
          </div>
        ) : manualName ? (
          <div className="flex items-center gap-2.5 bg-surface rounded-md p-2.5">
            <div className="flex-1 min-w-0 text-[12.5px] font-medium truncate">{manualName}</div>
            <button type="button" className="shrink-0 text-[11px] font-semibold text-blue cursor-pointer" onClick={() => setManualName("")}>Cambiar</button>
          </div>
        ) : (
          <ProductMatchPicker referencePhotoUrl={null} onConfirm={(r: ProductMatchResult) => ("catalogItem" in r ? setSelected(r.catalogItem) : setManualName(r.manualName))} />
        )}
        {!selected && manualName && (
          <div className="text-[10.5px] text-steel mt-1">Nombre a mano — no se buscará historial de costo con este proveedor.</div>
        )}
      </div>

      <div className="mt-2.5">
        <label className="block mb-1.5 text-[10px] font-semibold uppercase tracking-wide text-steel">Cantidad</label>
        <input type="number" min={1} className="w-24 rounded border border-rule bg-surface px-2.5 py-1.5 text-[13px] font-bold" value={quantity} onChange={(e) => setQuantity(e.target.value)} />
      </div>

      {error && <div className="text-red text-[11.5px] mt-2">{error}</div>}

      <div className="flex gap-2 mt-3">
        <button type="button" className="flex-1 rounded border border-rule px-3 py-2 text-[12px] font-semibold cursor-pointer" onClick={onCancel}>Cancelar</button>
        <button type="button" disabled={!canSave} className="flex-1 rounded border border-teal bg-teal px-3 py-2 text-[12px] font-bold text-navy cursor-pointer disabled:opacity-40" onClick={save}>
          {saving ? "Agregando…" : "Agregar a la solicitud"}
        </button>
      </div>
    </div>
  );
}
