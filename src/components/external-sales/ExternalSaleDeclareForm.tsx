"use client";

import { useEffect, useRef, useState } from "react";
import { Check, Upload } from "lucide-react";
import { ProductMatchPicker, type MatchCatalogItem, type ProductMatchResult } from "@/components/merchandise-reentry/ProductMatchPicker";
import { ClientMatchPicker, type ClientDTO } from "@/components/external-sales/ClientMatchPicker";
import { uploadFile } from "@/lib/uploadFile";
import { usePasteFile } from "@/lib/usePasteFile";
import { formatDateTime } from "@/lib/formatDateTime";
import { CatalogCode } from "@/components/shared/CatalogCode";

type SaleItemDTO = {
  id: string;
  catalogItemId: string | null;
  declaredProductName: string;
  catalogItem: { name: string; photos: string[]; justCode: string | null } | null;
  quantity: number;
  unitPrice: number;
  totalAmount: number;
  rejectedAt: string | null;
  rejectionReason: string | null;
};

type SaleDTO = {
  id: string;
  code: string;
  items: SaleItemDTO[];
  totalAmount: number;
  pickupPersonName: string;
  courierNote: string | null;
  client: ClientDTO | null;
  reviewStatus: "PENDING" | "APPROVED" | "REJECTED";
  rejectionReason: string | null;
  paymentProofUrl: string | null;
  paymentProofName: string | null;
  paymentConfirmedAt: string | null;
  deliveredAt: string | null;
  nairobyClosedAt: string | null;
  deletedAt: string | null;
};

type DraftItem = { product: MatchCatalogItem; quantity: string; unitPrice: string };

async function postJson(url: string, body?: unknown) {
  const res = await fetch(url, { method: "POST", headers: { "Content-Type": "application/json" }, body: body ? JSON.stringify(body) : undefined });
  const data = await res.json().catch(() => null);
  if (!res.ok) throw new Error(data?.error ?? "Ocurrió un error.");
  return data;
}

async function patchJson(url: string, body: unknown) {
  const res = await fetch(url, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
  const data = await res.json().catch(() => null);
  if (!res.ok) throw new Error(data?.error ?? "Ocurrió un error.");
  return data;
}

function statusLabel(s: SaleDTO): { text: string; color: string } {
  if (s.deletedAt) return { text: `Eliminada por admin · ${formatDateTime(s.deletedAt)}`, color: "text-red" };
  if (s.reviewStatus === "REJECTED") return { text: "Rechazada", color: "text-red" };
  if (s.reviewStatus === "PENDING") return { text: "Esperando aprobación de Bryan", color: "text-gold" };
  if (s.nairobyClosedAt) return { text: `Cerrada · ${formatDateTime(s.nairobyClosedAt)}`, color: "text-green" };
  if (!s.paymentProofUrl) return { text: "Aprobada — falta subir comprobante", color: "text-blue" };
  if (!s.paymentConfirmedAt) return { text: "Esperando que confirmen el pago", color: "text-gold" };
  if (!s.deliveredAt) return { text: `Pago confirmado · ${formatDateTime(s.paymentConfirmedAt)} — esperando entrega`, color: "text-blue" };
  return { text: `Entregado · ${formatDateTime(s.deliveredAt)} — esperando cierre de Nairoby`, color: "text-gold" };
}

// Constructor de productos, reutilizado al declarar una venta nueva y al
// corregir y reenviar una venta rechazada completa.
function ItemsEditor({ items, onChange, searchUrl }: { items: DraftItem[]; onChange: (items: DraftItem[]) => void; searchUrl: string }) {
  const [picking, setPicking] = useState(items.length === 0);
  const [draftProduct, setDraftProduct] = useState<MatchCatalogItem | null>(null);
  const [draftQty, setDraftQty] = useState("");
  const [draftPrice, setDraftPrice] = useState("");

  function addDraft() {
    if (!draftProduct) return;
    const qty = Number(draftQty) || 0;
    const price = Number(draftPrice) || 0;
    if (qty <= 0 || price <= 0) return;
    onChange([...items, { product: draftProduct, quantity: draftQty, unitPrice: draftPrice }]);
    setDraftProduct(null);
    setDraftQty("");
    setDraftPrice("");
    setPicking(false);
  }

  function removeAt(i: number) {
    onChange(items.filter((_, idx) => idx !== i));
  }

  const total = items.reduce((sum, it) => sum + (Number(it.quantity) || 0) * (Number(it.unitPrice) || 0), 0);

  return (
    <div className="flex flex-col gap-2.5">
      {items.length > 0 && (
        <div className="flex flex-col gap-1.5">
          {items.map((it, i) => (
            <div key={i} className="flex items-center gap-2 bg-cloud rounded-md p-2">
              {it.product.photos[0] && (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={it.product.photos[0]} alt={it.product.name} className="w-9 h-9 object-cover rounded border border-rule shrink-0" />
              )}
              <div className="flex-1 min-w-0 text-[12px]">
                <div className="font-semibold flex items-center gap-1.5 flex-wrap min-w-0">
                  <CatalogCode code={it.product.justCode} />
                  <span className="truncate">{it.product.name}</span>
                </div>
                <div className="text-steel">
                  {Number(it.quantity) || 0} un. × ${(Number(it.unitPrice) || 0).toFixed(2)} = ${((Number(it.quantity) || 0) * (Number(it.unitPrice) || 0)).toFixed(2)}
                </div>
              </div>
              <button type="button" className="shrink-0 text-[11px] font-semibold text-red cursor-pointer" onClick={() => removeAt(i)}>Quitar</button>
            </div>
          ))}
          <div className="text-[12px] font-bold">Total: ${total.toFixed(2)}</div>
        </div>
      )}

      {picking ? (
        draftProduct ? (
          <div className="bg-green/10 border border-green/35 rounded-md p-2.5">
            <div className="flex items-center gap-2.5 mb-2">
              {draftProduct.photos[0] && (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={draftProduct.photos[0]} alt={draftProduct.name} className="w-11 h-11 object-cover rounded border border-green/40 shrink-0" />
              )}
              <div className="flex-1 min-w-0 text-[12.5px] font-semibold flex items-center gap-1.5">
                <CatalogCode code={draftProduct.justCode} />
                <span className="truncate">{draftProduct.name}</span>
              </div>
              <button type="button" className="shrink-0 text-[11px] font-semibold text-blue cursor-pointer" onClick={() => setDraftProduct(null)}>Cambiar</button>
            </div>
            <div className="flex gap-2.5 mb-2">
              <div className="flex-1">
                <label className="block mb-1 text-[10px] font-semibold uppercase tracking-wide text-steel">Cantidad</label>
                <input type="number" min={1} className="w-full rounded border border-rule bg-surface px-2.5 py-1.5 text-[13px] font-bold" value={draftQty} onChange={(e) => setDraftQty(e.target.value)} />
              </div>
              <div className="flex-1">
                <label className="block mb-1 text-[10px] font-semibold uppercase tracking-wide text-steel">Precio unitario</label>
                <input type="number" min={0} step="0.01" className="w-full rounded border border-rule bg-surface px-2.5 py-1.5 text-[13px] font-bold" value={draftPrice} onChange={(e) => setDraftPrice(e.target.value)} />
              </div>
            </div>
            <div className="flex gap-2">
              {items.length > 0 && (
                <button type="button" className="flex-1 rounded border border-rule px-2.5 py-1.5 text-[11.5px] font-semibold cursor-pointer" onClick={() => { setDraftProduct(null); setDraftQty(""); setDraftPrice(""); setPicking(false); }}>
                  Cancelar
                </button>
              )}
              <button type="button" disabled={!(Number(draftQty) > 0 && Number(draftPrice) > 0)} className="flex-1 rounded border border-teal bg-teal px-2.5 py-1.5 text-[11.5px] font-bold text-navy cursor-pointer disabled:opacity-40" onClick={addDraft}>
                Agregar producto a la venta
              </button>
            </div>
          </div>
        ) : (
          <ProductMatchPicker
            referencePhotoUrl={null}
            searchUrl={searchUrl}
            onConfirm={(r: ProductMatchResult) => setDraftProduct(r)}
            onCancel={items.length > 0 ? () => setPicking(false) : undefined}
          />
        )
      ) : (
        <button type="button" className="self-start text-[11.5px] font-semibold text-blue cursor-pointer" onClick={() => setPicking(true)}>
          + Agregar otro producto
        </button>
      )}
    </div>
  );
}

export function ExternalSaleDeclareForm() {
  const [sales, setSales] = useState<SaleDTO[] | null>(null);
  const [client, setClient] = useState<ClientDTO | null>(null);
  const [items, setItems] = useState<DraftItem[]>([]);
  const [pickupPersonName, setPickupPersonName] = useState("");
  const [courierNote, setCourierNote] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [uploadingFor, setUploadingFor] = useState<string | null>(null);
  const armedProofSaleIdRef = useRef<string | null>(null);
  const { onPaste: onPasteProof, onMouseEnter: onPasteProofHoverIn, onMouseLeave: onPasteProofHoverOut, onTapPaste, tapHint: tapHintProof } = usePasteFile((file) => {
    const saleId = armedProofSaleIdRef.current;
    if (saleId) uploadProof(saleId, file);
  });

  const [editingId, setEditingId] = useState<string | null>(null);
  const [editClient, setEditClient] = useState<ClientDTO | null>(null);
  const [editItems, setEditItems] = useState<DraftItem[]>([]);
  const [editPickupPersonName, setEditPickupPersonName] = useState("");
  const [editCourierNote, setEditCourierNote] = useState("");
  const [editSaving, setEditSaving] = useState(false);
  const [editError, setEditError] = useState("");

  const [fixingItem, setFixingItem] = useState<{ saleId: string; itemId: string } | null>(null);
  const [fixProduct, setFixProduct] = useState<MatchCatalogItem | null>(null);
  const [fixQty, setFixQty] = useState("");
  const [fixPrice, setFixPrice] = useState("");
  const [fixSaving, setFixSaving] = useState(false);
  const [fixError, setFixError] = useState("");

  function load() {
    fetch("/api/external-sales").then((r) => r.json()).then(setSales).catch(() => setSales([]));
  }
  useEffect(load, []);

  const total = items.reduce((sum, it) => sum + (Number(it.quantity) || 0) * (Number(it.unitPrice) || 0), 0);
  const canSave = !!client && items.length > 0 && items.every((it) => Number(it.quantity) > 0 && Number(it.unitPrice) > 0) && pickupPersonName.trim().length > 0 && !saving;

  async function save() {
    if (!client || items.length === 0) return;
    setSaving(true);
    setError("");
    try {
      await postJson("/api/external-sales", {
        clientId: client.id,
        items: items.map((it) => ({ catalogItemId: it.product.id, quantity: Number(it.quantity), unitPrice: Number(it.unitPrice) })),
        pickupPersonName: pickupPersonName.trim(),
        courierNote: courierNote.trim() || undefined,
      });
      setClient(null);
      setItems([]);
      setPickupPersonName("");
      setCourierNote("");
      load();
    } catch (e) {
      setError(e instanceof Error ? e.message : "No se pudo declarar la venta.");
    } finally {
      setSaving(false);
    }
  }

  function startEdit(s: SaleDTO) {
    setEditingId(s.id);
    setEditClient(s.client);
    setEditItems(
      s.items.map((it) => ({
        product: { id: it.catalogItemId ?? "", name: it.catalogItem?.name ?? it.declaredProductName, justCode: it.catalogItem?.justCode ?? null, photos: it.catalogItem?.photos ?? [], pendingRegistration: false },
        quantity: String(it.quantity),
        unitPrice: String(it.unitPrice),
      }))
    );
    setEditPickupPersonName(s.pickupPersonName);
    setEditCourierNote(s.courierNote ?? "");
    setEditError("");
  }

  const editTotal = editItems.reduce((sum, it) => sum + (Number(it.quantity) || 0) * (Number(it.unitPrice) || 0), 0);
  const canSaveEdit = !!editClient && editItems.length > 0 && editItems.every((it) => Number(it.quantity) > 0 && Number(it.unitPrice) > 0) && editPickupPersonName.trim().length > 0 && !editSaving;

  async function saveEdit(saleId: string) {
    if (!editClient || editItems.length === 0) return;
    setEditSaving(true);
    setEditError("");
    try {
      await patchJson(`/api/external-sales/${saleId}`, {
        clientId: editClient.id,
        items: editItems.map((it) => ({ catalogItemId: it.product.id, quantity: Number(it.quantity), unitPrice: Number(it.unitPrice) })),
        pickupPersonName: editPickupPersonName.trim(),
        courierNote: editCourierNote.trim() || undefined,
      });
      setEditingId(null);
      load();
    } catch (e) {
      setEditError(e instanceof Error ? e.message : "No se pudo corregir la venta.");
    } finally {
      setEditSaving(false);
    }
  }

  function startFixItem(saleId: string, it: SaleItemDTO) {
    setFixingItem({ saleId, itemId: it.id });
    setFixProduct({ id: it.catalogItemId ?? "", name: it.catalogItem?.name ?? it.declaredProductName, justCode: it.catalogItem?.justCode ?? null, photos: it.catalogItem?.photos ?? [], pendingRegistration: false });
    setFixQty(String(it.quantity));
    setFixPrice(String(it.unitPrice));
    setFixError("");
  }

  async function saveFixItem() {
    if (!fixingItem || !fixProduct) return;
    const qty = Number(fixQty) || 0;
    const price = Number(fixPrice) || 0;
    if (qty <= 0 || price <= 0) return;
    setFixSaving(true);
    setFixError("");
    try {
      await patchJson(`/api/external-sales/${fixingItem.saleId}/items/${fixingItem.itemId}`, { catalogItemId: fixProduct.id, quantity: qty, unitPrice: price });
      setFixingItem(null);
      setFixProduct(null);
      load();
    } catch (e) {
      setFixError(e instanceof Error ? e.message : "No se pudo corregir el producto.");
    } finally {
      setFixSaving(false);
    }
  }

  async function deleteFixItem(saleId: string, itemId: string) {
    setFixSaving(true);
    setFixError("");
    try {
      const res = await fetch(`/api/external-sales/${saleId}/items/${itemId}`, { method: "DELETE" });
      const data = await res.json().catch(() => null);
      if (!res.ok) throw new Error(data?.error ?? "No se pudo eliminar el producto.");
      if (fixingItem?.itemId === itemId) setFixingItem(null);
      load();
    } catch (e) {
      setFixError(e instanceof Error ? e.message : "No se pudo eliminar el producto.");
    } finally {
      setFixSaving(false);
    }
  }

  async function uploadProof(saleId: string, file: File) {
    setUploadingFor(saleId);
    setError("");
    const uploaded = await uploadFile(file, "external-sale-payment-proofs");
    if (!uploaded.ok) {
      setError(uploaded.error);
      setUploadingFor(null);
      return;
    }
    try {
      await postJson(`/api/external-sales/${saleId}/payment-proof`, { proofUrl: uploaded.url, proofName: uploaded.name });
      load();
    } catch (e) {
      setError(e instanceof Error ? e.message : "No se pudo subir el comprobante.");
    } finally {
      setUploadingFor(null);
    }
  }

  return (
    <div className="flex flex-col gap-6 max-w-lg">
      <div className="bg-surface border border-rule rounded-md p-3.5 flex flex-col gap-3">
        <div className="font-display font-bold text-[14px]">Declarar venta</div>
        <div>
          <label className="block mb-1.5 text-[10px] font-semibold uppercase tracking-wide text-steel">Cliente</label>
          <ClientMatchPicker value={client} onChange={setClient} />
        </div>
        {!client ? (
          <div className="text-[11.5px] text-steel">Primero matricula o selecciona al cliente para poder declarar la venta.</div>
        ) : (
          <>
            <div>
              <label className="block mb-1.5 text-[10px] font-semibold uppercase tracking-wide text-steel">Productos</label>
              <ItemsEditor items={items} onChange={setItems} searchUrl="/api/external-sales/catalog-search" />
            </div>
            <div>
              <label className="block mb-1 text-[10px] font-semibold uppercase tracking-wide text-steel">A quién debe entregarle bodega (motorizado o cliente)</label>
              <input type="text" className="w-full rounded border border-rule bg-cloud px-2.5 py-1.5 text-[12.5px]" value={pickupPersonName} onChange={(e) => setPickupPersonName(e.target.value)} />
            </div>
            <div>
              <label className="block mb-1 text-[10px] font-semibold uppercase tracking-wide text-steel">Transportadora, si no es la habitual (opcional)</label>
              <input type="text" className="w-full rounded border border-rule bg-cloud px-2.5 py-1.5 text-[12.5px]" value={courierNote} onChange={(e) => setCourierNote(e.target.value)} />
            </div>
            {error && <div className="text-red text-[11.5px]">{error}</div>}
            <button type="button" disabled={!canSave} className="rounded border border-teal bg-teal px-3 py-2 text-[12.5px] font-bold text-navy cursor-pointer disabled:opacity-40" onClick={save}>
              {saving ? "Enviando…" : `Declarar venta${total > 0 ? ` — $${total.toFixed(2)}` : ""}`}
            </button>
          </>
        )}
      </div>

      <div>
        <div className="font-display font-bold text-[14px] mb-2.5">Mis ventas</div>
        {sales === null ? (
          <div className="text-[13px] text-steel">Cargando…</div>
        ) : sales.length === 0 ? (
          <div className="text-[13px] text-steel">Todavía no declaraste ninguna venta.</div>
        ) : (
          <div className="flex flex-col gap-2">
            {sales.map((s) => {
              const status = statusLabel(s);
              return (
                <div key={s.id} className="bg-surface border border-rule rounded-md p-3">
                  <div className="flex items-center gap-2 mb-1">
                    <span className="font-mono text-[11px] font-bold text-teal">{s.code}</span>
                    <span className={`text-[11px] font-semibold ${status.color}`}>{status.text}</span>
                  </div>
                  <div className="flex flex-col gap-1">
                    {s.items.map((it) => (
                      <div key={it.id}>
                        <div className="text-[12.5px] font-semibold flex items-center gap-1.5 flex-wrap">
                          {it.catalogItem && <CatalogCode code={it.catalogItem.justCode} />}
                          <span>{it.catalogItem?.name ?? it.declaredProductName} — {it.quantity} un. · ${it.totalAmount.toFixed(2)}</span>
                        </div>
                        {s.reviewStatus === "PENDING" && !s.deletedAt && it.rejectedAt && (
                          <div className="bg-red/5 border border-red/30 rounded-md p-2 mt-1">
                            <div className="text-[11px] text-red mb-1.5">Bryan lo rechazó: {it.rejectionReason}</div>
                            {fixingItem?.itemId === it.id ? (
                              <div>
                                {fixProduct && (
                                  <div className="flex items-center gap-2.5 bg-surface border border-rule rounded-md p-2 mb-2">
                                    {fixProduct.photos[0] && (
                                      // eslint-disable-next-line @next/next/no-img-element
                                      <img src={fixProduct.photos[0]} alt={fixProduct.name} className="w-9 h-9 object-cover rounded border border-rule shrink-0" />
                                    )}
                                    <div className="flex-1 min-w-0 text-[12px] font-semibold flex items-center gap-1.5">
                                      <CatalogCode code={fixProduct.justCode} />
                                      <span className="truncate">{fixProduct.name}</span>
                                    </div>
                                    <button type="button" className="shrink-0 text-[11px] font-semibold text-blue cursor-pointer" onClick={() => setFixProduct(null)}>Cambiar</button>
                                  </div>
                                )}
                                {!fixProduct && (
                                  <ProductMatchPicker referencePhotoUrl={null} searchUrl="/api/external-sales/catalog-search" onConfirm={(r) => setFixProduct(r)} />
                                )}
                                <div className="flex gap-2 mb-2">
                                  <div className="flex-1">
                                    <label className="block mb-1 text-[10px] font-semibold uppercase tracking-wide text-steel">Cantidad</label>
                                    <input type="number" min={1} className="w-full rounded border border-rule bg-surface px-2.5 py-1.5 text-[12.5px] font-bold" value={fixQty} onChange={(e) => setFixQty(e.target.value)} />
                                  </div>
                                  <div className="flex-1">
                                    <label className="block mb-1 text-[10px] font-semibold uppercase tracking-wide text-steel">Precio unitario</label>
                                    <input type="number" min={0} step="0.01" className="w-full rounded border border-rule bg-surface px-2.5 py-1.5 text-[12.5px] font-bold" value={fixPrice} onChange={(e) => setFixPrice(e.target.value)} />
                                  </div>
                                </div>
                                {fixError && <div className="text-red text-[11px] mb-1.5">{fixError}</div>}
                                <div className="flex gap-2">
                                  <button type="button" className="flex-1 rounded border border-rule px-2.5 py-1.5 text-[11.5px] font-semibold cursor-pointer" onClick={() => setFixingItem(null)}>Cancelar</button>
                                  <button type="button" disabled={fixSaving || !fixProduct || !(Number(fixQty) > 0 && Number(fixPrice) > 0)} className="flex-1 rounded border border-teal bg-teal px-2.5 py-1.5 text-[11.5px] font-bold text-navy cursor-pointer disabled:opacity-40" onClick={saveFixItem}>
                                    {fixSaving ? "Guardando…" : "Reenviar este producto"}
                                  </button>
                                </div>
                              </div>
                            ) : (
                              <div className="flex gap-1.5">
                                <button type="button" className="text-[11px] font-bold text-teal cursor-pointer" onClick={() => startFixItem(s.id, it)}>Corregir</button>
                                {s.items.length > 1 && (
                                  <button type="button" disabled={fixSaving} className="text-[11px] font-bold text-red cursor-pointer disabled:opacity-40" onClick={() => deleteFixItem(s.id, it.id)}>Eliminar producto</button>
                                )}
                              </div>
                            )}
                          </div>
                        )}
                      </div>
                    ))}
                  </div>
                  <div className="text-[11px] font-bold mt-0.5">Total: ${s.totalAmount.toFixed(2)}</div>
                  <div className="text-[10.5px] text-steel mt-0.5">Entrega a: {s.pickupPersonName}{s.courierNote ? ` · Transportadora: ${s.courierNote}` : ""}</div>
                  {s.client && (
                    <div className="text-[10.5px] text-steel mt-0.5">Cliente: {s.client.name} · {s.client.phone}</div>
                  )}
                  {!s.deletedAt && s.reviewStatus === "REJECTED" && s.rejectionReason && <div className="text-[11.5px] text-red mt-1">{s.rejectionReason}</div>}
                  {!s.deletedAt && s.reviewStatus === "REJECTED" && editingId !== s.id && (
                    <button type="button" className="mt-2 text-[11.5px] font-bold border border-teal text-teal rounded px-2.5 py-1.5 cursor-pointer" onClick={() => startEdit(s)}>
                      Corregir y reenviar
                    </button>
                  )}
                  {!s.deletedAt && s.reviewStatus === "REJECTED" && editingId === s.id && (
                    <div className="bg-cloud rounded-md p-2.5 mt-2 flex flex-col gap-2.5">
                      <div>
                        <label className="block mb-1 text-[10px] font-semibold uppercase tracking-wide text-steel">Cliente</label>
                        <ClientMatchPicker value={editClient} onChange={setEditClient} />
                      </div>
                      <div>
                        <label className="block mb-1 text-[10px] font-semibold uppercase tracking-wide text-steel">Productos</label>
                        <ItemsEditor items={editItems} onChange={setEditItems} searchUrl="/api/external-sales/catalog-search" />
                      </div>
                      <div>
                        <label className="block mb-1 text-[10px] font-semibold uppercase tracking-wide text-steel">A quién debe entregarle bodega</label>
                        <input type="text" className="w-full rounded border border-rule bg-surface px-2.5 py-1.5 text-[12px]" value={editPickupPersonName} onChange={(e) => setEditPickupPersonName(e.target.value)} />
                      </div>
                      <div>
                        <label className="block mb-1 text-[10px] font-semibold uppercase tracking-wide text-steel">Transportadora (opcional)</label>
                        <input type="text" className="w-full rounded border border-rule bg-surface px-2.5 py-1.5 text-[12px]" value={editCourierNote} onChange={(e) => setEditCourierNote(e.target.value)} />
                      </div>
                      {editError && <div className="text-red text-[11px]">{editError}</div>}
                      <div className="flex gap-2">
                        <button type="button" className="flex-1 rounded border border-rule px-2.5 py-1.5 text-[11.5px] font-semibold cursor-pointer" onClick={() => setEditingId(null)}>Cancelar</button>
                        <button type="button" disabled={!canSaveEdit} className="flex-1 rounded border border-teal bg-teal px-2.5 py-1.5 text-[11.5px] font-bold text-navy cursor-pointer disabled:opacity-40" onClick={() => saveEdit(s.id)}>
                          {editSaving ? "Reenviando…" : `Reenviar a Bryan${editTotal > 0 ? ` — $${editTotal.toFixed(2)}` : ""}`}
                        </button>
                      </div>
                    </div>
                  )}
                  {!s.deletedAt && s.reviewStatus === "APPROVED" && !s.paymentProofUrl && (
                    <div className="mt-2 max-w-xs">
                      <div
                        role="button"
                        tabIndex={0}
                        onPaste={onPasteProof}
                        onMouseEnter={() => { armedProofSaleIdRef.current = s.id; onPasteProofHoverIn(); }}
                        onMouseLeave={onPasteProofHoverOut}
                        onClick={(e) => { armedProofSaleIdRef.current = s.id; onTapPaste(e); }}
                        className="flex items-center justify-center gap-1.5 border-[1.5px] border-dashed border-rule rounded px-2.5 py-2 text-[11.5px] text-steel cursor-pointer hover:border-teal focus:border-teal focus:outline-none"
                      >
                        {uploadingFor === s.id ? <span className="w-3.5 h-3.5 rounded-full border-2 border-rule border-t-teal animate-spin" /> : <Upload size={12} />}
                        Pega el comprobante aquí (Ctrl+V, o toca en celular)
                      </div>
                      <label className="block w-full mt-1 py-1 text-center text-[11px] font-medium text-teal underline decoration-dotted cursor-pointer">
                        o selecciona un archivo
                        <input type="file" accept="image/*,.pdf" className="hidden" onChange={(e) => { const f = e.target.files?.[0]; if (f) uploadProof(s.id, f); }} />
                      </label>
                      {tapHintProof && <p className="mt-1 text-[10.5px] text-red text-center">{tapHintProof}</p>}
                    </div>
                  )}
                  {s.paymentProofUrl && (
                    <div className="flex items-center gap-1.5 text-[11.5px] mt-2">
                      <a href={s.paymentProofUrl} target="_blank" rel="noreferrer" className="font-semibold text-blue underline">
                        Ver comprobante{s.paymentProofName ? ` (${s.paymentProofName})` : ""}
                      </a>
                      {!s.paymentConfirmedAt && <span className="flex items-center gap-1 text-blue font-semibold"><Check size={12} /> esperando confirmación</span>}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}
