"use client";

import { useEffect, useRef, useState } from "react";
import { CheckCircle2, DollarSign, ExternalLink, Upload, XCircle, Wallet } from "lucide-react";
import { uploadFile } from "@/lib/uploadFile";

type ItemDTO = {
  id: string;
  declaredName: string;
  quantity: number;
  catalogItem: { name: string; photos: string[] } | null;
  unitCostAtExchange: number | null;
  expectedCreditAmount: number | null;
  linkedPurchaseRequest: { requestNumber: number | null; requestedAt: string } | null;
  batch: { id: string; code: string; createdAt: string; documentPhotoUrls: string[]; supplier: { id: string; name: string } | null };
};

type CreditTotal = {
  supplierId: string;
  supplierName: string;
  total: number;
  credits: { id: string; amount: number; batchCode: string; itemName: string; createdAt: string }[];
};

type Choice = "REPLACED" | "CREDIT_ISSUED" | "REJECTED";

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

// Agrupa manteniendo el orden en que aparece cada lote — confirmado
// 2026-08-27, pedido explícito del usuario: nunca mezclar lotes distintos
// entre sí (cada uno es su propio cartón físico armado por Daniel), solo
// agrupar los productos que ya vienen juntos en el mismo lote.
function groupByBatch(items: ItemDTO[]) {
  const order: string[] = [];
  const byBatch = new Map<string, { batch: ItemDTO["batch"]; items: ItemDTO[] }>();
  for (const item of items) {
    if (!byBatch.has(item.batch.id)) {
      order.push(item.batch.id);
      byBatch.set(item.batch.id, { batch: item.batch, items: [] });
    }
    byBatch.get(item.batch.id)!.items.push(item);
  }
  return order.map((id) => byBatch.get(id)!);
}

// Confirmado 2026-08-26/27, pedido explícito del usuario: acá gestiona quien
// solicitó ORIGINALMENTE la compra de cada producto que se está cambiando
// con un proveedor (o Bryan si el producto no tenía compra vinculada) — no
// Daniel. Vive dentro de "Mi área de trabajo" → "Registro de Egresos" →
// "Cambio con proveedor" (esa pestaña se vuelve visible aunque esta persona
// no tenga ningún otro acceso al módulo). Cada lote (cartón físico) se
// muestra separado con su foto de evidencia; arriba se ve el crédito ya
// confirmado por proveedor entre todos sus lotes. Cada producto admite una
// respuesta MIXTA (parte cambiada, parte con crédito o rechazo) resolviendo
// solo una cantidad parcial — el resto queda pendiente para resolverlo aparte.
export function SupplierExchangeMyResolutions() {
  const [items, setItems] = useState<ItemDTO[] | null>(null);
  const [creditTotals, setCreditTotals] = useState<CreditTotal[]>([]);
  const [choosing, setChoosing] = useState<{ id: string; choice: Choice } | null>(null);
  const [note, setNote] = useState("");
  const [amount, setAmount] = useState("");
  const [splitQty, setSplitQty] = useState("");
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
    fetch("/api/merchandise-outflow/supplier-exchange/credit-totals")
      .then((r) => (r.ok ? r.json() : []))
      .then((data) => setCreditTotals(Array.isArray(data) ? data : []))
      .catch(() => setCreditTotals([]));
  }
  useEffect(load, []);

  function startChoosing(item: ItemDTO, choice: Choice) {
    setChoosing({ id: item.id, choice });
    setNote("");
    setSplitQty(String(item.quantity));
    // Precarga el monto con el crédito estimado (según la última compra a
    // este proveedor) — se puede corregir si el proveedor ofrece un monto
    // distinto al final.
    setAmount(choice === "CREDIT_ISSUED" && item.expectedCreditAmount !== null ? item.expectedCreditAmount.toFixed(2) : "");
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

  async function resolve(item: ItemDTO) {
    if (!choosing) return;
    setSaving(true);
    setError("");
    try {
      const qty = Number(splitQty);
      if (!qty || qty <= 0 || qty > item.quantity) throw new Error(`Ingresa una cantidad válida (máximo ${item.quantity}).`);
      const quantity = qty === item.quantity ? undefined : qty;

      if (choosing.choice === "REPLACED") {
        await postJson(`/api/merchandise-outflow/items/${choosing.id}/resolve-supplier`, { resolution: "REPLACED", quantity, note: note.trim() || undefined });
      } else if (choosing.choice === "CREDIT_ISSUED") {
        const amt = Number(amount);
        if (!amt || amt <= 0) throw new Error("Ingresa un monto válido para el crédito.");
        if (!proofUrl) throw new Error("Sube el comprobante — captura del chat o documento donde el proveedor acepta.");
        await postJson(`/api/merchandise-outflow/items/${choosing.id}/resolve-supplier`, {
          resolution: "CREDIT_ISSUED",
          quantity,
          amount: amt,
          proofUrl,
          proofName: proofName ?? undefined,
          note: note.trim() || undefined,
        });
      } else {
        if (!note.trim()) throw new Error("Cuenta qué te dijo el proveedor — esto avisa urgente a admin, Nairoby y Daniel.");
        await postJson(`/api/merchandise-outflow/items/${choosing.id}/resolve-supplier`, {
          resolution: "REJECTED",
          quantity,
          note: note.trim(),
          proofUrl: proofUrl ?? undefined,
          proofName: proofName ?? undefined,
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

  const groups = groupByBatch(items);
  const relevantSupplierIds = new Set(items.map((i) => i.batch.supplier?.id).filter((x): x is string => !!x));
  const relevantTotals = creditTotals.filter((t) => relevantSupplierIds.has(t.supplierId));

  return (
    <div className="flex flex-col gap-4 max-w-lg">
      <div className="text-[12.5px] font-semibold text-steel">
        {items.length} solicitud{items.length === 1 ? "" : "es"} de gestión pendiente{items.length === 1 ? "" : "s"}
      </div>

      {relevantTotals.length > 0 && (
        <div className="flex flex-col gap-1.5">
          {relevantTotals.map((t) => (
            <div key={t.supplierId} className="flex items-center gap-2 bg-blue/10 border border-blue/30 rounded-md px-3 py-2">
              <Wallet size={13} className="text-blue shrink-0" />
              <div className="text-[12px] flex-1 min-w-0">
                <span className="font-semibold">{t.supplierName}</span> — crédito ya confirmado:{" "}
                <span className="font-bold text-blue">{money(t.total)}</span>
                <span className="text-steel"> ({t.credits.map((c) => `${money(c.amount)} de ${c.batchCode}`).join(", ")})</span>
              </div>
            </div>
          ))}
        </div>
      )}

      {groups.map(({ batch, items: batchItems }) => (
        <div key={batch.id} className="bg-surface border border-rule rounded-md p-3.5 flex flex-col gap-3">
          <div className="flex items-center gap-2 flex-wrap">
            <span className="font-mono text-[11px] font-bold text-teal">{batch.code}</span>
            <span className="text-[12px] font-semibold">{batch.supplier?.name ?? "—"}</span>
            <a href={`/cambio-proveedor/${batch.id}`} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-0.5 text-[10.5px] text-blue font-semibold cursor-pointer">
              <ExternalLink size={10} /> Ver guía
            </a>
          </div>
          {batch.documentPhotoUrls.length > 0 && (
            <div className="flex gap-1.5 flex-wrap">
              {batch.documentPhotoUrls.map((p, i) => (
                // eslint-disable-next-line @next/next/no-img-element
                <img key={i} src={p} alt={`Evidencia ${i + 1}`} className="w-14 h-14 object-cover rounded border border-rule" />
              ))}
            </div>
          )}

          <div className="flex flex-col divide-y divide-rule">
            {batchItems.map((item) => (
              <div key={item.id} className="pt-3 first:pt-0">
                <div className="flex items-center gap-3 mb-2.5">
                  {item.catalogItem?.photos[0] && (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img src={item.catalogItem.photos[0]} alt={itemName(item)} className="w-12 h-12 object-cover rounded border border-rule shrink-0" />
                  )}
                  <div className="flex-1 min-w-0">
                    <div className="text-[13px] font-semibold truncate">{itemName(item)}</div>
                    <div className="text-[11px] text-steel">{item.quantity} un.</div>
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
                    {item.quantity > 1 && (
                      <>
                        <div className="text-[12px] font-semibold mb-1.5">
                          ¿Cuántas de las {item.quantity} unidades? <span className="text-steel font-normal">(si el proveedor dio una respuesta mixta, registra el resto por separado)</span>
                        </div>
                        <input type="number" min={1} max={item.quantity} className="w-20 rounded border border-rule bg-surface px-2 py-1 text-[12px] font-bold mb-2" value={splitQty} onChange={(e) => setSplitQty(e.target.value)} />
                      </>
                    )}
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
                    <div className="text-[12px] font-semibold mb-1.5">
                      {choosing.choice === "REJECTED" ? "¿Qué te dijo el proveedor? (obligatorio)" : "Nota (opcional)"}
                    </div>
                    <textarea className="w-full rounded border border-rule bg-surface px-2.5 py-1.5 text-[12px] mb-2" rows={2} value={note} onChange={(e) => setNote(e.target.value)} placeholder="Nota breve…" />
                    {choosing.choice === "REJECTED" && (
                      <div className="text-[11px] text-red mb-2">Esto avisa urgente a admin, Nairoby y Daniel — hay riesgo de perder la mercadería y el pago.</div>
                    )}
                    {error && <div className="text-red text-[11px] mb-1.5">{error}</div>}
                    <div className="flex gap-2">
                      <button type="button" className="flex-1 rounded border border-rule px-2.5 py-1.5 text-[11.5px] font-semibold cursor-pointer" onClick={() => setChoosing(null)}>Cancelar</button>
                      <button type="button" disabled={saving} className="flex-1 rounded border border-teal bg-teal px-2.5 py-1.5 text-[11.5px] font-bold text-navy cursor-pointer disabled:opacity-40" onClick={() => resolve(item)}>
                        {saving ? "Guardando…" : "Confirmar"}
                      </button>
                    </div>
                  </div>
                ) : (
                  <div className="flex gap-1.5 flex-wrap">
                    <button type="button" className="flex items-center gap-1 text-[11.5px] font-semibold border border-green/40 text-green rounded-full px-2.5 py-1 cursor-pointer" onClick={() => startChoosing(item, "REPLACED")}>
                      <CheckCircle2 size={12} /> El proveedor cambió el producto
                    </button>
                    <button type="button" className="flex items-center gap-1 text-[11.5px] font-semibold border border-blue/40 text-blue rounded-full px-2.5 py-1 cursor-pointer" onClick={() => startChoosing(item, "CREDIT_ISSUED")}>
                      <DollarSign size={12} /> El proveedor dio crédito
                    </button>
                    <button type="button" className="flex items-center gap-1 text-[11.5px] font-semibold border border-red/40 text-red rounded-full px-2.5 py-1 cursor-pointer" onClick={() => startChoosing(item, "REJECTED")}>
                      <XCircle size={12} /> El proveedor rechazó todo
                    </button>
                  </div>
                )}
              </div>
            ))}
          </div>
        </div>
      ))}
    </div>
  );
}
