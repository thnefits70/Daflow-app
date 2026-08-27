"use client";

import { useEffect, useRef, useState } from "react";
import { CheckCircle2, DollarSign, ExternalLink, Upload } from "lucide-react";
import { uploadFile } from "@/lib/uploadFile";

type ItemDTO = {
  id: string;
  declaredName: string;
  quantity: number;
  catalogItem: { name: string; photos: string[] } | null;
  unitCostAtExchange: number | null;
  expectedCreditAmount: number | null;
  linkedPurchaseRequest: { requestNumber: number | null; requestedAt: string } | null;
  batch: { id: string; code: string; createdAt: string; supplier: { id: string; name: string } | null };
};

type Choice = "REPLACED" | "CREDIT_ISSUED";

function money(n: number) {
  return `$${n.toFixed(2)}`;
}

async function postJson(url: string, body?: unknown) {
  const res = await fetch(url, { method: "POST", headers: { "Content-Type": "application/json" }, body: body ? JSON.stringify(body) : undefined });
  const data = await res.json().catch(() => null);
  if (!res.ok) throw new Error(data?.error ?? "Ocurrió un error.");
  return data;
}

function itemName(item: ItemDTO) {
  return item.catalogItem?.name ?? item.declaredName;
}

// Confirmado 2026-08-26, pedido explícito del usuario: acá gestiona quien
// solicitó ORIGINALMENTE la compra de cada producto que se está cambiando
// con un proveedor (o Bryan si el producto no tiene compra vinculada) — no
// Daniel. Vive en una página standalone (/area/cambio-proveedor-gestiones)
// porque esta persona puede no tener ningún otro acceso a Registro de
// Egresos. Reusa exactamente el mismo flujo de decisión (cambio/crédito +
// comprobante) que antes vivía en el tab de Daniel.
export function SupplierExchangeMyResolutions() {
  const [items, setItems] = useState<ItemDTO[] | null>(null);
  const [choosing, setChoosing] = useState<{ id: string; choice: Choice } | null>(null);
  const [note, setNote] = useState("");
  const [amount, setAmount] = useState("");
  const [proofUrl, setProofUrl] = useState<string | null>(null);
  const [proofName, setProofName] = useState<string | null>(null);
  const [uploading, setUploading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const fileInputRef = useRef<HTMLInputElement>(null);

  function load() {
    fetch("/api/merchandise-outflow/supplier-exchange/mine")
      .then((r) => r.json())
      .then((data) => setItems(Array.isArray(data) ? data : []))
      .catch(() => setItems([]));
  }
  useEffect(load, []);

  function startChoosing(id: string, choice: Choice, expectedCreditAmount: number | null) {
    setChoosing({ id, choice });
    setNote("");
    // Precarga el monto con el crédito estimado (según la última compra a
    // este proveedor) — se puede corregir si el proveedor ofrece un monto
    // distinto al final.
    setAmount(choice === "CREDIT_ISSUED" && expectedCreditAmount !== null ? expectedCreditAmount.toFixed(2) : "");
    setProofUrl(null);
    setProofName(null);
    setError("");
  }

  async function handleProofFile(file: File) {
    setUploading(true);
    setError("");
    const uploaded = await uploadFile(file, "supplier-credits");
    setUploading(false);
    if (!uploaded.ok) {
      setError(uploaded.error);
      return;
    }
    setProofUrl(uploaded.url);
    setProofName(uploaded.name);
  }

  async function resolve() {
    if (!choosing) return;
    setSaving(true);
    setError("");
    try {
      if (choosing.choice === "REPLACED") {
        await postJson(`/api/merchandise-outflow/items/${choosing.id}/resolve-supplier`, { resolution: "REPLACED", note: note.trim() || undefined });
      } else {
        const amt = Number(amount);
        if (!amt || amt <= 0) throw new Error("Ingresa un monto válido para el crédito.");
        if (!proofUrl) throw new Error("Sube el comprobante — captura del chat o documento donde el proveedor acepta.");
        await postJson(`/api/merchandise-outflow/items/${choosing.id}/resolve-supplier`, {
          resolution: "CREDIT_ISSUED",
          amount: amt,
          proofUrl,
          proofName: proofName ?? undefined,
          note: note.trim() || undefined,
        });
      }
      setChoosing(null);
      load();
    } catch (e) {
      setError(e instanceof Error ? e.message : "No se pudo resolver.");
    } finally {
      setSaving(false);
    }
  }

  if (items === null) return <div className="text-[13px] text-steel">Cargando…</div>;
  if (items.length === 0) return <div className="text-[13px] text-steel">No tienes cambios con proveedor pendientes de gestionar.</div>;

  return (
    <div className="flex flex-col gap-2.5 max-w-lg">
      <div className="text-[12.5px] font-semibold text-steel">
        {items.length} solicitud{items.length === 1 ? "" : "es"} de gestión pendiente{items.length === 1 ? "" : "s"}
      </div>
      {items.map((item) => (
        <div key={item.id} className="bg-surface border border-rule rounded-md p-3.5">
          <div className="flex items-center gap-3 mb-2.5">
            {item.catalogItem?.photos[0] && (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={item.catalogItem.photos[0]} alt={itemName(item)} className="w-12 h-12 object-cover rounded border border-rule shrink-0" />
            )}
            <div className="flex-1 min-w-0">
              <div className="text-[13px] font-semibold truncate">{itemName(item)}</div>
              <div className="text-[11px] text-steel">{item.quantity} un. · {item.batch.supplier?.name ?? "—"}</div>
              <div className="flex items-center gap-1.5 text-[10.5px] text-steel">
                <span>{item.batch.code}</span>
                <a href={`/cambio-proveedor/${item.batch.id}`} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-0.5 text-blue font-semibold cursor-pointer">
                  <ExternalLink size={10} /> Ver guía
                </a>
              </div>
              {item.expectedCreditAmount !== null ? (
                <div className="text-[10.5px] text-steel mt-0.5">
                  Pagado: <span className="font-semibold text-ink">{money(item.unitCostAtExchange!)}/un.</span> · crédito estimado: <span className="font-semibold text-blue">{money(item.expectedCreditAmount)}</span>
                </div>
              ) : (
                <div className="text-[10.5px] text-steel mt-0.5">Sin historial de compra a este proveedor.</div>
              )}
            </div>
          </div>

          {choosing?.id === item.id ? (
            <div className="bg-cloud rounded-md p-2.5">
              {choosing.choice === "CREDIT_ISSUED" && (
                <>
                  <div className="text-[12px] font-semibold mb-1.5">Monto del crédito</div>
                  <div className="flex items-center gap-1.5 mb-2">
                    <DollarSign size={13} className="text-steel" />
                    <input type="number" min={0} step="0.01" className="w-28 rounded border border-rule bg-surface px-2 py-1 text-[12px] font-bold" value={amount} onChange={(e) => setAmount(e.target.value)} />
                  </div>
                  <div className="text-[12px] font-semibold mb-1.5">Comprobante</div>
                  {proofUrl ? (
                    <div className="flex items-center gap-2 mb-2 text-[11.5px] text-green font-semibold">
                      <CheckCircle2 size={13} /> {proofName ?? "Comprobante subido"}
                    </div>
                  ) : (
                    <>
                      <input ref={fileInputRef} type="file" accept="image/*,.pdf" className="hidden" onChange={(e) => { const f = e.target.files?.[0]; if (f) handleProofFile(f); }} />
                      <button type="button" disabled={uploading} className="flex items-center gap-1.5 text-[11.5px] font-semibold border border-rule rounded px-2.5 py-1.5 cursor-pointer mb-2 disabled:opacity-60" onClick={() => fileInputRef.current?.click()}>
                        <Upload size={12} /> {uploading ? "Subiendo…" : "Subir comprobante (chat/documento)"}
                      </button>
                    </>
                  )}
                </>
              )}
              <div className="text-[12px] font-semibold mb-1.5">Nota (opcional)</div>
              <textarea className="w-full rounded border border-rule bg-surface px-2.5 py-1.5 text-[12px] mb-2" rows={2} value={note} onChange={(e) => setNote(e.target.value)} placeholder="Nota breve…" />
              {error && <div className="text-red text-[11px] mb-1.5">{error}</div>}
              <div className="flex gap-2">
                <button type="button" className="flex-1 rounded border border-rule px-2.5 py-1.5 text-[11.5px] font-semibold cursor-pointer" onClick={() => setChoosing(null)}>Cancelar</button>
                <button type="button" disabled={saving} className="flex-1 rounded border border-teal bg-teal px-2.5 py-1.5 text-[11.5px] font-bold text-navy cursor-pointer disabled:opacity-40" onClick={resolve}>
                  {saving ? "Guardando…" : "Confirmar"}
                </button>
              </div>
            </div>
          ) : (
            <div className="flex gap-1.5 flex-wrap">
              <button type="button" className="flex items-center gap-1 text-[11.5px] font-semibold border border-green/40 text-green rounded-full px-2.5 py-1 cursor-pointer" onClick={() => startChoosing(item.id, "REPLACED", item.expectedCreditAmount)}>
                <CheckCircle2 size={12} /> El proveedor cambió el producto
              </button>
              <button type="button" className="flex items-center gap-1 text-[11.5px] font-semibold border border-blue/40 text-blue rounded-full px-2.5 py-1 cursor-pointer" onClick={() => startChoosing(item.id, "CREDIT_ISSUED", item.expectedCreditAmount)}>
                <DollarSign size={12} /> El proveedor dio crédito
              </button>
            </div>
          )}
        </div>
      ))}
    </div>
  );
}
