"use client";

import { useEffect, useRef, useState } from "react";
import { Check, Upload } from "lucide-react";
import { ProductMatchPicker, type MatchCatalogItem, type ProductMatchResult } from "@/components/merchandise-reentry/ProductMatchPicker";
import { uploadFile } from "@/lib/uploadFile";
import { usePasteFile } from "@/lib/usePasteFile";
import { formatDateTime } from "@/lib/formatDateTime";
import { CatalogCode } from "@/components/shared/CatalogCode";

type SaleDTO = {
  id: string;
  code: string;
  catalogItemId: string | null;
  declaredProductName: string;
  catalogItem: { name: string; justCode: string | null } | null;
  quantity: number;
  unitPrice: number;
  totalAmount: number;
  pickupPersonName: string;
  courierNote: string | null;
  reviewStatus: "PENDING" | "APPROVED" | "REJECTED";
  rejectionReason: string | null;
  paymentProofUrl: string | null;
  paymentProofName: string | null;
  paymentConfirmedAt: string | null;
  deliveredAt: string | null;
  nairobyClosedAt: string | null;
};

async function postJson(url: string, body?: unknown) {
  const res = await fetch(url, { method: "POST", headers: { "Content-Type": "application/json" }, body: body ? JSON.stringify(body) : undefined });
  const data = await res.json().catch(() => null);
  if (!res.ok) throw new Error(data?.error ?? "Ocurrió un error.");
  return data;
}

function statusLabel(s: SaleDTO): { text: string; color: string } {
  if (s.reviewStatus === "REJECTED") return { text: "Rechazada", color: "text-red" };
  if (s.reviewStatus === "PENDING") return { text: "Esperando aprobación de Bryan", color: "text-gold" };
  if (s.nairobyClosedAt) return { text: `Cerrada · ${formatDateTime(s.nairobyClosedAt)}`, color: "text-green" };
  if (!s.paymentProofUrl) return { text: "Aprobada — falta subir comprobante", color: "text-blue" };
  if (!s.paymentConfirmedAt) return { text: "Esperando que confirmen el pago", color: "text-gold" };
  if (!s.deliveredAt) return { text: `Pago confirmado · ${formatDateTime(s.paymentConfirmedAt)} — esperando entrega`, color: "text-blue" };
  return { text: `Entregado · ${formatDateTime(s.deliveredAt)} — esperando cierre de Nairoby`, color: "text-gold" };
}

export function ExternalSaleDeclareForm() {
  const [sales, setSales] = useState<SaleDTO[] | null>(null);
  const [selected, setSelected] = useState<MatchCatalogItem | null>(null);
  const [quantity, setQuantity] = useState("");
  const [unitPrice, setUnitPrice] = useState("");
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
  const [editSelected, setEditSelected] = useState<MatchCatalogItem | null>(null);
  const [editQuantity, setEditQuantity] = useState("");
  const [editUnitPrice, setEditUnitPrice] = useState("");
  const [editPickupPersonName, setEditPickupPersonName] = useState("");
  const [editCourierNote, setEditCourierNote] = useState("");
  const [editSaving, setEditSaving] = useState(false);
  const [editError, setEditError] = useState("");

  function load() {
    fetch("/api/external-sales").then((r) => r.json()).then(setSales).catch(() => setSales([]));
  }
  useEffect(load, []);

  const qty = Number(quantity) || 0;
  const price = Number(unitPrice) || 0;
  const canSave = !!selected && qty > 0 && price > 0 && pickupPersonName.trim().length > 0 && !saving;

  async function save() {
    if (!selected) return;
    setSaving(true);
    setError("");
    try {
      await postJson("/api/external-sales", {
        catalogItemId: selected.id,
        quantity: qty,
        unitPrice: price,
        pickupPersonName: pickupPersonName.trim(),
        courierNote: courierNote.trim() || undefined,
      });
      setSelected(null);
      setQuantity("");
      setUnitPrice("");
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
    setEditSelected(
      s.catalogItemId
        ? { id: s.catalogItemId, name: s.catalogItem?.name ?? s.declaredProductName, justCode: s.catalogItem?.justCode ?? null, photos: [], pendingRegistration: false }
        : null
    );
    setEditQuantity(String(s.quantity));
    setEditUnitPrice(String(s.unitPrice));
    setEditPickupPersonName(s.pickupPersonName);
    setEditCourierNote(s.courierNote ?? "");
    setEditError("");
  }

  const editQty = Number(editQuantity) || 0;
  const editPrice = Number(editUnitPrice) || 0;
  const canSaveEdit = !!editSelected && editQty > 0 && editPrice > 0 && editPickupPersonName.trim().length > 0 && !editSaving;

  async function saveEdit(saleId: string) {
    if (!editSelected) return;
    setEditSaving(true);
    setEditError("");
    try {
      await fetch(`/api/external-sales/${saleId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          catalogItemId: editSelected.id,
          quantity: editQty,
          unitPrice: editPrice,
          pickupPersonName: editPickupPersonName.trim(),
          courierNote: editCourierNote.trim() || undefined,
        }),
      }).then(async (res) => {
        const data = await res.json().catch(() => null);
        if (!res.ok) throw new Error(data?.error ?? "No se pudo corregir la venta.");
      });
      setEditingId(null);
      load();
    } catch (e) {
      setEditError(e instanceof Error ? e.message : "No se pudo corregir la venta.");
    } finally {
      setEditSaving(false);
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
          <label className="block mb-1.5 text-[10px] font-semibold uppercase tracking-wide text-steel">Producto</label>
          {selected ? (
            <div className="flex items-center gap-2.5 bg-green/10 border border-green/35 rounded-md p-2.5">
              <div className="flex-1 min-w-0 text-[12.5px] font-semibold flex items-center gap-1.5">
                <CatalogCode code={selected.justCode} />
                <span className="truncate">{selected.name}</span>
              </div>
              <button type="button" className="shrink-0 text-[11px] font-semibold text-blue cursor-pointer" onClick={() => setSelected(null)}>Cambiar</button>
            </div>
          ) : (
            <ProductMatchPicker
              referencePhotoUrl={null}
              searchUrl="/api/external-sales/catalog-search"
              onConfirm={(r: ProductMatchResult) => setSelected(r)}
            />
          )}
        </div>
        <div className="flex gap-2.5">
          <div className="flex-1">
            <label className="block mb-1 text-[10px] font-semibold uppercase tracking-wide text-steel">Cantidad</label>
            <input type="number" min={1} className="w-full rounded border border-rule bg-cloud px-2.5 py-1.5 text-[13px] font-bold" value={quantity} onChange={(e) => setQuantity(e.target.value)} />
          </div>
          <div className="flex-1">
            <label className="block mb-1 text-[10px] font-semibold uppercase tracking-wide text-steel">Precio unitario</label>
            <input type="number" min={0} step="0.01" className="w-full rounded border border-rule bg-cloud px-2.5 py-1.5 text-[13px] font-bold" value={unitPrice} onChange={(e) => setUnitPrice(e.target.value)} />
          </div>
        </div>
        {qty > 0 && price > 0 && <div className="text-[12px] text-steel">Total: <span className="font-bold text-ink">${(qty * price).toFixed(2)}</span></div>}
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
          {saving ? "Enviando…" : "Declarar venta"}
        </button>
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
                  <div className="text-[12.5px] font-semibold flex items-center gap-1.5 flex-wrap">
                    {s.catalogItem && <CatalogCode code={s.catalogItem.justCode} />}
                    <span>{s.catalogItem?.name ?? s.declaredProductName} — {s.quantity} un. · ${s.totalAmount.toFixed(2)}</span>
                  </div>
                  <div className="text-[10.5px] text-steel mt-0.5">Entrega a: {s.pickupPersonName}{s.courierNote ? ` · Transportadora: ${s.courierNote}` : ""}</div>
                  {s.reviewStatus === "REJECTED" && s.rejectionReason && <div className="text-[11.5px] text-red mt-1">{s.rejectionReason}</div>}
                  {s.reviewStatus === "REJECTED" && editingId !== s.id && (
                    <button type="button" className="mt-2 text-[11.5px] font-bold border border-teal text-teal rounded px-2.5 py-1.5 cursor-pointer" onClick={() => startEdit(s)}>
                      Corregir y reenviar
                    </button>
                  )}
                  {s.reviewStatus === "REJECTED" && editingId === s.id && (
                    <div className="bg-cloud rounded-md p-2.5 mt-2 flex flex-col gap-2.5">
                      <div>
                        <label className="block mb-1 text-[10px] font-semibold uppercase tracking-wide text-steel">Producto</label>
                        {editSelected ? (
                          <div className="flex items-center gap-2.5 bg-green/10 border border-green/35 rounded-md p-2">
                            <div className="flex-1 min-w-0 text-[12px] font-semibold flex items-center gap-1.5">
                              <CatalogCode code={editSelected.justCode} />
                              <span className="truncate">{editSelected.name}</span>
                            </div>
                            <button type="button" className="shrink-0 text-[11px] font-semibold text-blue cursor-pointer" onClick={() => setEditSelected(null)}>Cambiar</button>
                          </div>
                        ) : (
                          <ProductMatchPicker
                            referencePhotoUrl={null}
                            searchUrl="/api/external-sales/catalog-search"
                            onConfirm={(r: ProductMatchResult) => setEditSelected(r)}
                          />
                        )}
                      </div>
                      <div className="flex gap-2">
                        <div className="flex-1">
                          <label className="block mb-1 text-[10px] font-semibold uppercase tracking-wide text-steel">Cantidad</label>
                          <input type="number" min={1} className="w-full rounded border border-rule bg-surface px-2.5 py-1.5 text-[12.5px] font-bold" value={editQuantity} onChange={(e) => setEditQuantity(e.target.value)} />
                        </div>
                        <div className="flex-1">
                          <label className="block mb-1 text-[10px] font-semibold uppercase tracking-wide text-steel">Precio unitario</label>
                          <input type="number" min={0} step="0.01" className="w-full rounded border border-rule bg-surface px-2.5 py-1.5 text-[12.5px] font-bold" value={editUnitPrice} onChange={(e) => setEditUnitPrice(e.target.value)} />
                        </div>
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
                          {editSaving ? "Reenviando…" : "Reenviar a Bryan"}
                        </button>
                      </div>
                    </div>
                  )}
                  {s.reviewStatus === "APPROVED" && !s.paymentProofUrl && (
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
