"use client";

import { useEffect, useState } from "react";
import { Camera, Check, Plus, Search, Send, Trash2, X } from "lucide-react";
import { LiveCameraCapture } from "@/components/shared/LiveCameraCapture";
import { ProductMatchPicker, type MatchCatalogItem, type ProductMatchResult } from "@/components/merchandise-reentry/ProductMatchPicker";
import { CatalogCode } from "@/components/shared/CatalogCode";
import { clearFormDraft } from "@/lib/useFormDraft";

const DAMAGE_REASONS = ["Producto roto", "Empaque abierto", "Humedad/manchado", "Golpeado", "Otro"];

type SupplierOption = { id: string; name: string };
type ItemDTO = {
  id: string;
  declaredName: string;
  quantity: number;
  catalogItem: { name: string; photos: string[]; justCode: string | null } | null;
  damageReason: { name: string } | null;
  damageReasonOther: string | null;
};
type BatchDTO = { id: string; code: string; documentPhotoUrls: string[]; supplier: SupplierOption | null; items: ItemDTO[] };

async function postJson(url: string, body?: unknown) {
  const res = await fetch(url, { method: "POST", headers: { "Content-Type": "application/json" }, body: body ? JSON.stringify(body) : undefined });
  const data = await res.json().catch(() => null);
  if (!res.ok) throw new Error(data?.error ?? "Ocurrió un error.");
  return data;
}

function itemName(item: ItemDTO) {
  return item.catalogItem?.name ?? item.declaredName;
}

// Reporte de producto(s) encontrados dañados en bodega — NO una devolución
// (eso vive en Reingreso). Rediseñado 2026-09-21, pedido explícito de Daniel:
// antes era un paso único por producto (foto + producto + cantidad + motivo,
// directo a la cola). Ahora es el mismo patrón "carrito" que ya usa Cambio
// con proveedor (draft + batches/[id]/items + submit): primero se elige el
// proveedor — para que Jariel ya sepa con quién comunicarse si el reclamo se
// escalona más adelante, ver PurchaseDeteriorGestionPanel — y sobre ese
// mismo reporte se agregan uno o varios productos, cada uno con su propia
// cantidad y motivo, pero con UNA SOLA foto compartida para todo el reporte.
// El proveedor elegido acá es solo una sugerencia para Jariel: él lo sigue
// confirmando a mano antes de anclar el reclamo a una compra real.
// Confirmado 2026-09-02, sigue vigente: allowUpload queda atado a canAct
// (exclusivo de Daniel) — el resto del equipo reporta con cámara en vivo.
export function DeteriorCapture({ allowUpload = false, onReported }: { allowUpload?: boolean; onReported?: () => void }) {
  const [loading, setLoading] = useState(true);
  const [batch, setBatch] = useState<BatchDTO | null>(null);
  const [error, setError] = useState("");
  const [adding, setAdding] = useState(false);
  const [taking, setTaking] = useState(false);
  const [confirmingSubmit, setConfirmingSubmit] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [sentCode, setSentCode] = useState<string | null>(null);
  const [sentCount, setSentCount] = useState(0);
  const [confirmDeleteItemId, setConfirmDeleteItemId] = useState<string | null>(null);
  const [confirmDeleteBatch, setConfirmDeleteBatch] = useState(false);
  const [zoomedPhoto, setZoomedPhoto] = useState<string | null>(null);

  // Búsqueda de proveedor — solo antes de que exista un borrador.
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<SupplierOption[]>([]);
  const [startingSupplier, setStartingSupplier] = useState<SupplierOption | null>(null);
  const [starting, setStarting] = useState(false);

  function loadDraft() {
    fetch("/api/merchandise-outflow/draft?reason=DETERIORO")
      .then((r) => r.json())
      .then((data) => setBatch(data ?? null))
      .catch(() => setBatch(null))
      .finally(() => setLoading(false));
  }

  useEffect(loadDraft, []);
  // Limpia cualquier borrador local que haya quedado del flujo anterior de
  // un solo producto (useFormDraft, clave "outflow-deterioro:new") — este
  // rediseño ya no lo usa, el reporte en progreso vive en el servidor.
  useEffect(() => clearFormDraft("outflow-deterioro:new"), []);

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
      const created = await postJson("/api/merchandise-outflow/draft", { reason: "DETERIORO", supplierId: startingSupplier.id });
      setBatch({ ...created, items: created.items ?? [] });
    } catch (e) {
      setError(e instanceof Error ? e.message : "No se pudo iniciar el reporte.");
    } finally {
      setStarting(false);
    }
  }

  async function setPhoto(url: string | null) {
    if (!batch) return;
    setTaking(false);
    const photoUrls = url ? [url] : [];
    setBatch({ ...batch, documentPhotoUrls: photoUrls });
    try {
      await postJson(`/api/merchandise-outflow/batches/${batch.id}/photos`, { photoUrls });
    } catch (e) {
      setError(e instanceof Error ? e.message : "No se pudo guardar la foto.");
    }
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
      setSentCount(batch.items.length);
      setBatch(null);
      setConfirmingSubmit(false);
      onReported?.();
    } catch (e) {
      setError(e instanceof Error ? e.message : "No se pudo enviar el reporte.");
    } finally {
      setSubmitting(false);
    }
  }

  function reset() {
    setSentCode(null);
    setSentCount(0);
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
        <div className="font-display font-bold text-[15px] mb-1.5">{sentCode} reportado</div>
        <p className="text-[12.5px] text-steel mb-4">
          Daniel ya fue avisado — {sentCount} producto{sentCount === 1 ? "" : "s"} en este reporte.
        </p>
        <button type="button" className="text-[12.5px] font-bold text-teal cursor-pointer" onClick={reset}>
          Reportar otro
        </button>
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
        <p className="text-[11px] text-steel mb-3">Para que quien gestione el reclamo con el proveedor ya sepa con quién comunicarse.</p>
        {error && <div className="text-red text-[11.5px] mb-2">{error}</div>}
        <button type="button" disabled={!startingSupplier || starting} className="w-full rounded border border-teal bg-teal px-3.5 py-2.5 text-[13px] font-bold text-navy cursor-pointer disabled:opacity-40" onClick={startBatch}>
          {starting ? "Iniciando…" : "Empezar reporte"}
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
            <Trash2 size={12} /> Cancelar reporte
          </button>
        )}
      </div>

      {confirmDeleteBatch && (
        <div className="bg-red/10 border border-red/40 rounded-md p-3.5 mb-3">
          <div className="font-display font-bold text-[13.5px] mb-1">¿Eliminar todo el reporte {batch.code}?</div>
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
                    <span className="text-[12.5px] font-semibold flex items-center gap-1.5 min-w-0">
                      {item.catalogItem && <CatalogCode code={item.catalogItem.justCode} />}
                      <span className="truncate">{itemName(item)}</span>
                    </span>
                    <div className="flex items-center gap-2 shrink-0">
                      <span className="font-mono text-[11px] text-steel">{item.quantity} un.</span>
                      <button type="button" className="text-steel hover:text-red cursor-pointer" onClick={() => setConfirmDeleteItemId(item.id)}>
                        <X size={13} />
                      </button>
                    </div>
                  </div>
                </div>
                <div className="text-[11px] text-steel mt-1">Motivo: <span className="font-semibold text-ink">{item.damageReason?.name ?? item.damageReasonOther ?? "—"}</span></div>
              </div>
            )
          )}
        </div>
      )}

      {error && <div className="text-red text-[12px] mb-2">{error}</div>}

      {adding ? (
        <AddDeteriorItemForm batchId={batch.id} onAdded={() => { setAdding(false); loadDraft(); }} onCancel={() => setAdding(false)} />
      ) : (
        <button
          type="button"
          className="w-full flex items-center justify-center gap-1.5 rounded-md border-[1.5px] border-dashed border-rule px-3.5 py-2.5 text-[12.5px] font-semibold cursor-pointer hover:border-teal mb-3"
          onClick={() => setAdding(true)}
        >
          <Plus size={14} /> Agregar producto al reporte
        </button>
      )}

      <div className="bg-surface border border-rule rounded-md p-3.5 mb-3">
        <label className="block mb-1.5 text-[10px] font-semibold uppercase tracking-wide text-steel">Foto del producto dañado</label>
        {batch.documentPhotoUrls[0] ? (
          <div className="flex items-center gap-2">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={batch.documentPhotoUrls[0]} alt="Foto del deterioro" className="w-20 h-20 object-cover rounded-md border border-rule cursor-zoom-in" onClick={() => setZoomedPhoto(batch.documentPhotoUrls[0])} />
            <button type="button" className="text-[11.5px] text-blue font-semibold cursor-pointer" onClick={() => setTaking(true)}>Volver a tomar</button>
          </div>
        ) : taking ? (
          <LiveCameraCapture allowUpload={allowUpload} folder="merchandise-outflow-photos" onCaptured={setPhoto} onCancel={() => setTaking(false)} />
        ) : (
          <button type="button" className="flex items-center gap-1.5 text-[12.5px] font-bold border-[1.5px] border-rule rounded-md px-3.5 py-2 cursor-pointer" onClick={() => setTaking(true)}>
            <Camera size={14} /> {allowUpload ? "Tomar o subir foto" : "Tomar foto en vivo"}
          </button>
        )}
        <div className="text-[10.5px] text-steel mt-1.5">Una sola foto para todo el reporte, aunque agregues varios productos.</div>
      </div>

      {!confirmingSubmit && (
        <button
          type="button"
          disabled={!canSubmit}
          title={!canSubmit ? "Agrega al menos un producto y la foto antes de enviar" : undefined}
          className="w-full flex items-center justify-center gap-1.5 rounded border border-teal bg-teal px-3.5 py-2.5 text-[13px] font-bold text-navy cursor-pointer disabled:opacity-40"
          onClick={() => setConfirmingSubmit(true)}
        >
          <Send size={14} /> Reportar deterioro
        </button>
      )}
      {confirmingSubmit && (
        <div className="bg-surface border border-rule rounded-md p-4">
          <div className="font-display font-bold text-[14px] mb-3">¿Ya está completo el reporte?</div>
          <p className="text-[11.5px] text-steel mb-3">Esto avisa a Daniel de inmediato para que resuelva cada producto.</p>
          <div className="flex gap-2">
            <button type="button" className="flex-1 rounded border border-rule px-3 py-2 text-[12.5px] font-semibold cursor-pointer" onClick={() => setConfirmingSubmit(false)}>Revisar de nuevo</button>
            <button type="button" disabled={submitting} className="flex-1 rounded border border-teal bg-teal px-3 py-2 text-[12.5px] font-bold text-navy cursor-pointer disabled:opacity-60" onClick={submitBatch}>
              {submitting ? "Enviando…" : "Sí, reportar"}
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

function AddDeteriorItemForm({ batchId, onAdded, onCancel }: { batchId: string; onAdded: () => void; onCancel: () => void }) {
  const [selected, setSelected] = useState<MatchCatalogItem | null>(null);
  const [quantity, setQuantity] = useState("");
  const [damageReason, setDamageReason] = useState("");
  const [damageReasonOther, setDamageReasonOther] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  const qty = Number(quantity) || 0;
  const hasReason = !!damageReason && (damageReason !== "Otro" || damageReasonOther.trim().length > 0);
  const canSave = !!selected && qty > 0 && hasReason && !saving;

  async function save() {
    setSaving(true);
    setError("");
    try {
      await postJson(`/api/merchandise-outflow/batches/${batchId}/items`, {
        catalogItemId: selected!.id,
        quantity: qty,
        damageReasonName: damageReason,
        damageReasonOther: damageReason === "Otro" ? damageReasonOther.trim() : undefined,
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
            <div className="flex-1 min-w-0 text-[12.5px] font-semibold flex items-center gap-1.5">
              <CatalogCode code={selected.justCode} />
              <span className="truncate">{selected.name}</span>
            </div>
            <button type="button" className="shrink-0 text-[11px] font-semibold text-blue cursor-pointer" onClick={() => setSelected(null)}>Cambiar</button>
          </div>
        ) : (
          <ProductMatchPicker referencePhotoUrl={null} onConfirm={(r: ProductMatchResult) => setSelected(r)} />
        )}
      </div>

      <div className="mt-2.5">
        <label className="block mb-1.5 text-[10px] font-semibold uppercase tracking-wide text-steel">Cantidad dañada</label>
        <input type="number" min={1} className="w-24 rounded border border-rule bg-surface px-2.5 py-1.5 text-[13px] font-bold text-red" value={quantity} onChange={(e) => setQuantity(e.target.value)} />
      </div>

      <div className="mt-2.5">
        <label className="block mb-1.5 text-[10px] font-semibold uppercase tracking-wide text-steel">Motivo del daño</label>
        <div className="flex gap-1.5 flex-wrap">
          {DAMAGE_REASONS.map((r) => (
            <button key={r} type="button" onClick={() => setDamageReason(r)} className={`text-[11.5px] font-semibold rounded-full px-2.5 py-1 border cursor-pointer ${damageReason === r ? "border-teal text-teal bg-teal/15" : "border-rule text-steel"}`}>
              {r}
            </button>
          ))}
        </div>
        {damageReason === "Otro" && (
          <input type="text" placeholder="Describe el motivo" className="w-full mt-1.5 rounded border border-rule bg-surface px-2.5 py-1.5 text-[12px]" value={damageReasonOther} onChange={(e) => setDamageReasonOther(e.target.value)} />
        )}
      </div>

      {error && <div className="text-red text-[11.5px] mt-2">{error}</div>}

      <div className="flex gap-2 mt-3">
        <button type="button" className="flex-1 rounded border border-rule px-3 py-2 text-[12px] font-semibold cursor-pointer" onClick={onCancel}>Cancelar</button>
        <button type="button" disabled={!canSave} className="flex-1 rounded border border-teal bg-teal px-3 py-2 text-[12px] font-bold text-navy cursor-pointer disabled:opacity-40" onClick={save}>
          {saving ? "Agregando…" : "Agregar al reporte"}
        </button>
      </div>
    </div>
  );
}
