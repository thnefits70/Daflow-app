"use client";

import { useEffect, useState } from "react";
import { Check, Upload } from "lucide-react";
import { ProductMatchPicker, type MatchCatalogItem, type ProductMatchResult } from "@/components/merchandise-reentry/ProductMatchPicker";
import { uploadFile } from "@/lib/uploadFile";

type SaleDTO = {
  id: string;
  code: string;
  declaredProductName: string;
  catalogItem: { name: string } | null;
  quantity: number;
  unitPrice: number;
  totalAmount: number;
  reviewStatus: "PENDING" | "APPROVED" | "REJECTED";
  rejectionReason: string | null;
  paymentProofUrl: string | null;
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
  if (s.nairobyClosedAt) return { text: "Cerrada", color: "text-green" };
  if (!s.paymentProofUrl) return { text: "Aprobada — falta subir comprobante", color: "text-blue" };
  if (!s.paymentConfirmedAt) return { text: "Esperando que confirmen el pago", color: "text-gold" };
  if (!s.deliveredAt) return { text: "Pago confirmado — esperando entrega", color: "text-blue" };
  return { text: "Pago y entrega listos — esperando cierre de Nairoby", color: "text-gold" };
}

export function ExternalSaleDeclareForm() {
  const [sales, setSales] = useState<SaleDTO[] | null>(null);
  const [selected, setSelected] = useState<MatchCatalogItem | null>(null);
  const [manualName, setManualName] = useState("");
  const [quantity, setQuantity] = useState("");
  const [unitPrice, setUnitPrice] = useState("");
  const [pickupPersonName, setPickupPersonName] = useState("");
  const [courierNote, setCourierNote] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [uploadingFor, setUploadingFor] = useState<string | null>(null);

  function load() {
    fetch("/api/external-sales").then((r) => r.json()).then(setSales).catch(() => setSales([]));
  }
  useEffect(load, []);

  const qty = Number(quantity) || 0;
  const price = Number(unitPrice) || 0;
  const hasName = !!selected || manualName.trim().length > 0;
  const canSave = hasName && qty > 0 && price > 0 && pickupPersonName.trim().length > 0 && !saving;

  async function save() {
    setSaving(true);
    setError("");
    try {
      await postJson("/api/external-sales", {
        catalogItemId: selected?.id,
        declaredProductName: selected ? undefined : manualName.trim(),
        quantity: qty,
        unitPrice: price,
        pickupPersonName: pickupPersonName.trim(),
        courierNote: courierNote.trim() || undefined,
      });
      setSelected(null);
      setManualName("");
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
              <div className="flex-1 min-w-0 text-[12.5px] font-semibold truncate">{selected.name}</div>
              <button type="button" className="shrink-0 text-[11px] font-semibold text-blue cursor-pointer" onClick={() => setSelected(null)}>Cambiar</button>
            </div>
          ) : manualName ? (
            <div className="flex items-center gap-2.5 bg-cloud rounded-md p-2.5">
              <div className="flex-1 min-w-0 text-[12.5px] font-medium truncate">{manualName}</div>
              <button type="button" className="shrink-0 text-[11px] font-semibold text-blue cursor-pointer" onClick={() => setManualName("")}>Cambiar</button>
            </div>
          ) : (
            <ProductMatchPicker
              referencePhotoUrl={null}
              searchUrl="/api/external-sales/catalog-search"
              onConfirm={(r: ProductMatchResult) => ("catalogItem" in r ? setSelected(r.catalogItem) : setManualName(r.manualName))}
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
                  <div className="text-[12.5px] font-semibold">{s.catalogItem?.name ?? s.declaredProductName} — {s.quantity} un. · ${s.totalAmount.toFixed(2)}</div>
                  {s.reviewStatus === "REJECTED" && s.rejectionReason && <div className="text-[11.5px] text-red mt-1">{s.rejectionReason}</div>}
                  {s.reviewStatus === "APPROVED" && !s.paymentProofUrl && (
                    <label className="mt-2 inline-flex items-center gap-1.5 text-[11.5px] font-semibold border border-rule rounded px-2.5 py-1.5 cursor-pointer">
                      <Upload size={12} /> {uploadingFor === s.id ? "Subiendo…" : "Subir comprobante de pago"}
                      <input type="file" accept="image/*,.pdf" className="hidden" onChange={(e) => { const f = e.target.files?.[0]; if (f) uploadProof(s.id, f); }} />
                    </label>
                  )}
                  {s.paymentProofUrl && !s.paymentConfirmedAt && (
                    <div className="flex items-center gap-1.5 text-[11.5px] text-blue font-semibold mt-2"><Check size={12} /> Comprobante subido, esperando confirmación</div>
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
