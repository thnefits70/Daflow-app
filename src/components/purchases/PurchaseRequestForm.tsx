"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { AlertTriangle, CheckCircle2, Lock, Upload } from "lucide-react";
import { uploadFile } from "@/lib/uploadFile";
import { compressImage } from "@/lib/compressImage";
import { usePasteFile } from "@/lib/usePasteFile";
import { PurchaseCatalogPicker, type CatalogItemDTO } from "./PurchaseCatalogPicker";
import { PurchaseSupplierPicker, type PurchaseSupplierDTO } from "./PurchaseSupplierPicker";

type PriceStats = { count: number; min: number | null; avg: number | null; max: number | null; last3Avg: number | null };
type QuoteReadResult = { readTotal: number | null; productNameFound: string | null; referenceCodeFound: string | null; matches: boolean };

export function PurchaseRequestForm() {
  const router = useRouter();
  const [catalogItem, setCatalogItem] = useState<CatalogItemDTO | null>(null);
  const [stats, setStats] = useState<PriceStats | null>(null);
  const [supplier, setSupplier] = useState<PurchaseSupplierDTO | null>(null);
  const [quantity, setQuantity] = useState("");
  const [unitCost, setUnitCost] = useState("");

  const [quoteFile, setQuoteFile] = useState<File | null>(null);
  const [quoteImageUrl, setQuoteImageUrl] = useState<string | null>(null);
  const [uploadingQuote, setUploadingQuote] = useState(false);
  const [verifying, setVerifying] = useState(false);
  const [verifyResult, setVerifyResult] = useState<QuoteReadResult | null>(null);
  const [manualCodeConfirm, setManualCodeConfirm] = useState(false);
  const onPasteQuote = usePasteFile((file) => handleQuoteFile(file));

  const [shippingIncluded, setShippingIncluded] = useState(true);
  const [carrier, setCarrier] = useState<PurchaseSupplierDTO | null>(null);
  const [shippingCostTotal, setShippingCostTotal] = useState("");
  const [shippingPaymentMethod, setShippingPaymentMethod] = useState<"TRANSFER" | "PETTY_CASH">("TRANSFER");

  const [justification, setJustification] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  const [toast, setToast] = useState("");

  useEffect(() => {
    if (!catalogItem) {
      setStats(null);
      return;
    }
    fetch(`/api/purchase-catalog/${catalogItem.id}`)
      .then((r) => (r.ok ? r.json() : null))
      .then((data) => setStats(data?.stats ?? null))
      .catch(() => setStats(null));
  }, [catalogItem]);

  const qty = Number(quantity) || 0;
  const cost = Number(unitCost) || 0;
  const total = qty * cost;
  const effectiveCost = shippingIncluded || !shippingCostTotal ? cost : cost + Number(shippingCostTotal) / (qty || 1);
  const overThreshold = stats?.last3Avg !== null && stats?.last3Avg !== undefined && effectiveCost > stats.last3Avg;

  async function handleQuoteFile(file: File) {
    setQuoteFile(file);
    setVerifyResult(null);
    setManualCodeConfirm(false);
    setUploadingQuote(true);
    setErr("");
    const compressed = await compressImage(file);
    const uploaded = await uploadFile(compressed, "purchase-quotes");
    setUploadingQuote(false);
    if (!uploaded.ok) {
      setErr(uploaded.error);
      return;
    }
    setQuoteImageUrl(uploaded.url);
  }

  async function verifyQuote() {
    if (!quoteImageUrl || total <= 0) return;
    setVerifying(true);
    setErr("");
    const res = await fetch("/api/purchase-requests/verify-quote", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ quoteImageUrl, expectedTotal: total }),
    });
    setVerifying(false);
    const data = await res.json().catch(() => null);
    if (!res.ok) {
      setErr(data?.error ?? "No se pudo leer la cotización.");
      return;
    }
    setVerifyResult(data);
  }

  const quoteVerified = verifyResult?.matches || (verifyResult?.referenceCodeFound && manualCodeConfirm);

  async function submit() {
    if (!catalogItem || !supplier || qty <= 0 || cost <= 0 || !quoteImageUrl) {
      setErr("Completa el insumo, proveedor, cantidad, costo y la cotización.");
      return;
    }
    if (!quoteVerified) {
      setErr("Verifica la cotización antes de enviar.");
      return;
    }
    if (!shippingIncluded && !carrier) {
      setErr("Elige el transportista, ya que el envío no está incluido.");
      return;
    }
    if (overThreshold && !justification.trim()) {
      setErr("El costo está por encima del historial — agrega una justificación.");
      return;
    }
    setBusy(true);
    setErr("");
    const res = await fetch("/api/purchase-requests", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        catalogItemId: catalogItem.id,
        supplierId: supplier.id,
        quantity: qty,
        unitCost: cost,
        quoteImageUrl,
        quoteReadTotal: verifyResult?.readTotal ?? null,
        quoteReferenceCode: verifyResult?.referenceCodeFound ?? null,
        shippingIncluded,
        carrierId: shippingIncluded ? null : carrier?.id,
        shippingCostTotal: shippingIncluded ? null : Number(shippingCostTotal) || null,
        shippingPaymentMethod: shippingIncluded ? null : shippingPaymentMethod,
        justification: overThreshold ? justification.trim() : null,
      }),
    });
    setBusy(false);
    const data = await res.json().catch(() => null);
    if (!res.ok) {
      setErr(data?.error ?? "No se pudo enviar la solicitud.");
      return;
    }
    setToast("✅ Solicitud enviada — te llegará una notificación cuando se apruebe.");
    setCatalogItem(null);
    setSupplier(null);
    setQuantity("");
    setUnitCost("");
    setQuoteFile(null);
    setQuoteImageUrl(null);
    setVerifyResult(null);
    setCarrier(null);
    setShippingCostTotal("");
    setShippingIncluded(true);
    setJustification("");
    router.refresh();
  }

  return (
    <div className="bg-surface border border-rule rounded-md p-4.5">
      <div className="mb-3.5">
        <label className="block mb-1.5 text-[10px] font-semibold uppercase tracking-wide text-steel">Insumo</label>
        <PurchaseCatalogPicker value={catalogItem} onChange={setCatalogItem} />
      </div>

      {stats && stats.count > 0 && (
        <div className="grid grid-cols-3 gap-2.5 mb-3.5">
          <div className="bg-cloud border border-rule rounded-md p-2.5 text-center">
            <div className="text-[9px] uppercase text-steel mb-0.5">Precio más bajo</div>
            <div className="text-[15px] font-bold text-green">${stats.min?.toFixed(2)}</div>
          </div>
          <div className="bg-cloud border border-rule rounded-md p-2.5 text-center">
            <div className="text-[9px] uppercase text-steel mb-0.5">Promedio</div>
            <div className="text-[15px] font-bold text-teal">${stats.avg?.toFixed(2)}</div>
          </div>
          <div className="bg-cloud border border-rule rounded-md p-2.5 text-center">
            <div className="text-[9px] uppercase text-steel mb-0.5">Precio más alto</div>
            <div className="text-[15px] font-bold text-red">${stats.max?.toFixed(2)}</div>
          </div>
        </div>
      )}
      {catalogItem && (!stats || stats.count === 0) && (
        <div className="flex items-center gap-2 bg-cloud border border-rule rounded-md px-3 py-2 mb-3.5 text-[11.5px] text-steel">
          🆕 Sin historial previo — primera vez que se compra este insumo.
        </div>
      )}

      <div className="mb-3.5">
        <label className="block mb-1.5 text-[10px] font-semibold uppercase tracking-wide text-steel">Proveedor</label>
        <PurchaseSupplierPicker type="SUPPLIER" value={supplier} onChange={setSupplier} label="Buscar o registrar proveedor" />
      </div>

      <div className="grid grid-cols-2 sm:grid-cols-3 gap-2.5 mb-3.5">
        <div>
          <label className="block mb-1 text-[10px] font-semibold uppercase tracking-wide text-steel">Cantidad</label>
          <input type="number" min="1" className="w-full rounded border border-rule px-2.5 py-2 text-[13.5px]" value={quantity} onChange={(e) => setQuantity(e.target.value)} />
        </div>
        <div>
          <label className="block mb-1 text-[10px] font-semibold uppercase tracking-wide text-steel">Costo por unidad</label>
          <input type="number" min="0" step="0.01" className="w-full rounded border border-rule px-2.5 py-2 text-[13.5px]" value={unitCost} onChange={(e) => setUnitCost(e.target.value)} />
        </div>
        <div>
          <label className="block mb-1 text-[10px] font-semibold uppercase tracking-wide text-steel">Total</label>
          <div className="rounded border border-rule px-2.5 py-2 text-[13.5px] font-bold bg-cloud">${total.toFixed(2)}</div>
        </div>
      </div>

      <div className="mb-3.5">
        <label className="block mb-1.5 text-[10px] font-semibold uppercase tracking-wide text-steel">Cotización</label>
        {!quoteImageUrl ? (
          <label
            tabIndex={0}
            onPaste={onPasteQuote}
            className="flex items-center justify-center gap-2 border-[1.5px] border-dashed border-rule rounded-md py-4 cursor-pointer hover:border-teal focus:border-teal focus:outline-none text-steel text-[12.5px]"
          >
            {uploadingQuote ? <span className="w-4 h-4 rounded-full border-2 border-rule border-t-teal animate-spin" /> : <Upload size={16} />}
            Subir o pegar la cotización (clic aquí y Ctrl+V)
            <input type="file" accept="image/*" className="hidden" onChange={(e) => e.target.files?.[0] && handleQuoteFile(e.target.files[0])} />
          </label>
        ) : (
          <div className="bg-cloud border border-rule rounded-md p-3">
            <div className="flex items-center gap-3 mb-2.5">
              <img src={quoteImageUrl} alt="" className="w-14 h-14 rounded object-cover border border-rule" />
              <div className="flex-1 text-[12.5px] text-steel">
                Escrito: {qty} × ${cost.toFixed(2)} = <b className="text-ink">${total.toFixed(2)}</b>
              </div>
              {!verifyResult && (
                <button type="button" disabled={verifying || total <= 0} className="rounded border border-teal bg-teal px-3 py-1.5 text-[11.5px] font-bold text-navy cursor-pointer disabled:opacity-60" onClick={verifyQuote}>
                  {verifying ? "Leyendo…" : "Verificar"}
                </button>
              )}
            </div>

            {verifyResult && (
              <>
                {verifyResult.matches ? (
                  <div className="flex items-center gap-2 text-[12.5px] text-teal">
                    <CheckCircle2 size={14} /> Coinciden — total leído ${verifyResult.readTotal?.toFixed(2)}
                  </div>
                ) : verifyResult.referenceCodeFound ? (
                  <div>
                    <div className="flex items-center gap-2 text-[12.5px] text-gold mb-2" style={{ color: "#D9A441" }}>
                      🔎 La cotización solo trae el código &quot;{verifyResult.referenceCodeFound}&quot;, sin nombre de producto.
                    </div>
                    {!manualCodeConfirm ? (
                      <button type="button" className="rounded border border-teal bg-teal px-3 py-1.5 text-[11.5px] font-bold text-navy cursor-pointer" onClick={() => setManualCodeConfirm(true)}>
                        ✓ Sí, confirmo que &quot;{verifyResult.referenceCodeFound}&quot; es {catalogItem?.name}
                      </button>
                    ) : (
                      <div className="flex items-center gap-2 text-[12.5px] text-teal"><CheckCircle2 size={14} /> Confirmado</div>
                    )}
                  </div>
                ) : (
                  <div className="flex items-center gap-2 text-[12.5px] text-red">
                    <Lock size={14} /> No coincide — la cotización dice ${verifyResult.readTotal?.toFixed(2) ?? "?"}, pero se escribió ${total.toFixed(2)}. Corrige el número o sube la imagen correcta.
                  </div>
                )}
              </>
            )}
            <button type="button" className="text-[11px] text-steel mt-2 cursor-pointer" onClick={() => { setQuoteFile(null); setQuoteImageUrl(null); setVerifyResult(null); }}>
              Cambiar imagen
            </button>
          </div>
        )}
      </div>

      <label className="flex items-center gap-2 mb-3.5 text-[12.5px] text-steel cursor-pointer">
        <input type="checkbox" checked={shippingIncluded} onChange={(e) => setShippingIncluded(e.target.checked)} className="w-auto" />
        El costo del producto SÍ incluye el envío <span className="text-steel-dim">— desmárcalo solo si el proveedor cobra el flete por separado</span>
      </label>

      {!shippingIncluded && (
        <div className="bg-surface2 border border-rule rounded-md p-3.5 mb-3.5">
          <label className="block mb-1.5 text-[10px] font-semibold uppercase tracking-wide text-steel">Transportista</label>
          <PurchaseSupplierPicker type="CARRIER" value={carrier} onChange={setCarrier} label="Buscar o registrar transportista" />
          <div className="grid grid-cols-2 gap-2.5 mt-3">
            <div>
              <label className="block mb-1 text-[10px] font-semibold uppercase tracking-wide text-steel">Costo de envío (total)</label>
              <input type="number" min="0" step="0.01" className="w-full rounded border border-rule px-2.5 py-2 text-[13.5px]" value={shippingCostTotal} onChange={(e) => setShippingCostTotal(e.target.value)} />
            </div>
            <div>
              <label className="block mb-1 text-[10px] font-semibold uppercase tracking-wide text-steel">¿Cómo se pagó?</label>
              <select className="w-full rounded border border-rule bg-surface px-2.5 py-2 text-[13.5px]" value={shippingPaymentMethod} onChange={(e) => setShippingPaymentMethod(e.target.value as "TRANSFER" | "PETTY_CASH")}>
                <option value="TRANSFER">Transferencia bancaria</option>
                <option value="PETTY_CASH">Efectivo — caja chica</option>
              </select>
            </div>
          </div>
        </div>
      )}

      {overThreshold && (
        <div className="bg-red/10 border-[1.5px] border-red/45 rounded-md p-3.5 mb-3.5">
          <div className="flex items-center gap-1.5 text-[13px] font-bold text-red mb-1">
            <AlertTriangle size={14} /> Precio por encima del historial
          </div>
          <div className="text-[12px] text-steel mb-2.5">
            El costo por unidad es <b className="text-ink">${effectiveCost.toFixed(2)}</b>. El promedio de las últimas compras es <b className="text-ink">${stats!.last3Avg!.toFixed(2)}</b>. No se puede enviar sin explicar por qué.
          </div>
          <textarea
            className="w-full rounded border border-red/40 bg-surface2 px-2.5 py-2 text-[12.5px] resize-vertical min-h-[60px]"
            placeholder="Ej. El proveedor habitual no tiene stock esta semana…"
            value={justification}
            onChange={(e) => setJustification(e.target.value)}
          />
        </div>
      )}

      {toast && <div className="text-teal text-[12.5px] mb-3">{toast}</div>}
      {err && <div className="text-red text-[12.5px] mb-3">{err}</div>}
      <button type="button" disabled={busy} className="rounded border border-teal bg-teal px-4 py-2 text-[13px] font-bold text-navy cursor-pointer disabled:opacity-60" onClick={submit}>
        {busy ? "Enviando…" : "Enviar y confirmar"}
      </button>
    </div>
  );
}
