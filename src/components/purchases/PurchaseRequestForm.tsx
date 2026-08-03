"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { AlertTriangle, CheckCircle2, Lock, Upload, Plus, X, FileText, Clock } from "lucide-react";
import { uploadFile } from "@/lib/uploadFile";
import { compressImage } from "@/lib/compressImage";
import { usePasteFile } from "@/lib/usePasteFile";
import { PurchaseCatalogPicker, type CatalogItemDTO } from "./PurchaseCatalogPicker";
import { PurchaseSupplierPicker, type PurchaseSupplierDTO } from "./PurchaseSupplierPicker";

type PriceStats = { count: number; min: number | null; avg: number | null; max: number | null; last3Avg: number | null };
type QuoteReadResult = {
  readTotal: number | null;
  productNameFound: string | null;
  referenceCodeFound: string | null;
  matches: boolean;
  suggestedCatalogItem: { id: string; name: string } | null;
};

type Line = { catalogItem: CatalogItemDTO | null; quantity: string; unitCost: string; stats: PriceStats | null };
const emptyLine = (): Line => ({ catalogItem: null, quantity: "", unitCost: "", stats: null });

type Draft = {
  lines: { catalogItem: CatalogItemDTO | null; quantity: string; unitCost: string }[];
  supplier: PurchaseSupplierDTO | null;
  quoteImageUrl: string | null;
  verifyResult: QuoteReadResult | null;
  manualCodeConfirm: boolean;
  purchaseOrderUrl: string | null;
  shippingIncluded: boolean;
  carrier: PurchaseSupplierDTO | null;
  shippingCostTotal: string;
  shippingPaymentMethod: "TRANSFER" | "PETTY_CASH";
  justification: string;
};

// Confirmado 2026-07-31: si la persona sale de la página a medias, no debe
// perder lo que ya llevaba avanzado — se guarda un borrador en localStorage
// (los archivos ya se subieron a Storage apenas se eligen, así que lo que se
// persiste son solo URLs y texto, todo serializable) y se restaura solo, con
// un aviso arriba para que quede claro que es lo que ya tenía sin terminar.
const DRAFT_KEY = "daflow.purchaseRequestDraft.v1";

function draftHasContent(d: Pick<Draft, "lines" | "supplier" | "quoteImageUrl" | "purchaseOrderUrl" | "justification">) {
  return (
    d.lines.some((l) => l.catalogItem || l.quantity || l.unitCost) ||
    !!d.supplier ||
    !!d.quoteImageUrl ||
    !!d.purchaseOrderUrl ||
    !!d.justification.trim()
  );
}

// Confirmado 2026-07-31: una cotización suele traer varios productos — se
// arma como una lista de líneas (cada una con su propio insumo/cantidad/
// costo, comparada contra SU propio historial), pero comparten un solo
// proveedor, una sola cotización, y un solo envío/justificación, porque es
// una sola compra.
export function PurchaseRequestForm({ deptId }: { deptId: string }) {
  const router = useRouter();
  const [lines, setLines] = useState<Line[]>([emptyLine()]);
  const [supplier, setSupplier] = useState<PurchaseSupplierDTO | null>(null);

  const [quoteFile, setQuoteFile] = useState<File | null>(null);
  const [quoteImageUrl, setQuoteImageUrl] = useState<string | null>(null);
  const [uploadingQuote, setUploadingQuote] = useState(false);
  const [verifying, setVerifying] = useState(false);
  const [verifyResult, setVerifyResult] = useState<QuoteReadResult | null>(null);
  const [manualCodeConfirm, setManualCodeConfirm] = useState(false);
  const onPasteQuote = usePasteFile((file) => handleQuoteFile(file));

  const [purchaseOrderFile, setPurchaseOrderFile] = useState<File | null>(null);
  const [purchaseOrderUrl, setPurchaseOrderUrl] = useState<string | null>(null);
  const [uploadingPurchaseOrder, setUploadingPurchaseOrder] = useState(false);
  const onPastePurchaseOrder = usePasteFile((file) => handlePurchaseOrderFile(file));

  const [shippingIncluded, setShippingIncluded] = useState(true);
  const [carrier, setCarrier] = useState<PurchaseSupplierDTO | null>(null);
  const [shippingCostTotal, setShippingCostTotal] = useState("");
  const [shippingPaymentMethod, setShippingPaymentMethod] = useState<"TRANSFER" | "PETTY_CASH">("TRANSFER");

  const [justification, setJustification] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  const [toast, setToast] = useState("");

  const [hydrated, setHydrated] = useState(false);
  const [draftRestored, setDraftRestored] = useState(false);

  function updateLine(idx: number, patch: Partial<Line>) {
    setLines((ls) => ls.map((l, i) => (i === idx ? { ...l, ...patch } : l)));
  }

  function fetchLineStats(idx: number, catalogItemId: string) {
    fetch(`/api/purchase-catalog/${catalogItemId}`)
      .then((r) => (r.ok ? r.json() : null))
      .then((data) => updateLine(idx, { stats: data?.stats ?? null }))
      .catch(() => updateLine(idx, { stats: null }));
  }

  function setLineCatalogItem(idx: number, item: CatalogItemDTO | null) {
    updateLine(idx, { catalogItem: item, stats: null });
    if (!item) return;
    fetchLineStats(idx, item.id);
  }

  function addLine() {
    setLines((ls) => [...ls, emptyLine()]);
  }
  function removeLine(idx: number) {
    setLines((ls) => (ls.length > 1 ? ls.filter((_, i) => i !== idx) : ls));
  }

  // Restaura el borrador (si hay uno) una sola vez al montar, y recién
  // después habilita el autoguardado — así no se pisa el borrador guardado
  // con el estado vacío inicial antes de leerlo.
  useEffect(() => {
    try {
      const raw = localStorage.getItem(DRAFT_KEY);
      if (raw) {
        const d: Draft = JSON.parse(raw);
        const restoredLines: Line[] = (d.lines?.length ? d.lines : [emptyLine()]).map((l) => ({ ...l, stats: null }));
        setLines(restoredLines);
        setSupplier(d.supplier ?? null);
        setQuoteImageUrl(d.quoteImageUrl ?? null);
        setVerifyResult(d.verifyResult ?? null);
        setManualCodeConfirm(d.manualCodeConfirm ?? false);
        setPurchaseOrderUrl(d.purchaseOrderUrl ?? null);
        setShippingIncluded(d.shippingIncluded ?? true);
        setCarrier(d.carrier ?? null);
        setShippingCostTotal(d.shippingCostTotal ?? "");
        setShippingPaymentMethod(d.shippingPaymentMethod ?? "TRANSFER");
        setJustification(d.justification ?? "");
        restoredLines.forEach((l, i) => l.catalogItem && fetchLineStats(i, l.catalogItem.id));
        setDraftRestored(draftHasContent(d));
      }
    } catch {
      // Borrador corrupto o ilegible — se ignora y se arranca en blanco.
    }
    setHydrated(true);
  }, []);

  useEffect(() => {
    if (!hydrated) return;
    const draft: Draft = {
      lines: lines.map(({ catalogItem, quantity, unitCost }) => ({ catalogItem, quantity, unitCost })),
      supplier,
      quoteImageUrl,
      verifyResult,
      manualCodeConfirm,
      purchaseOrderUrl,
      shippingIncluded,
      carrier,
      shippingCostTotal,
      shippingPaymentMethod,
      justification,
    };
    if (draftHasContent(draft)) {
      localStorage.setItem(DRAFT_KEY, JSON.stringify(draft));
    } else {
      localStorage.removeItem(DRAFT_KEY);
    }
  }, [hydrated, lines, supplier, quoteImageUrl, verifyResult, manualCodeConfirm, purchaseOrderUrl, shippingIncluded, carrier, shippingCostTotal, shippingPaymentMethod, justification]);

  function resetForm() {
    setLines([emptyLine()]);
    setSupplier(null);
    setQuoteFile(null);
    setQuoteImageUrl(null);
    setVerifyResult(null);
    setManualCodeConfirm(false);
    setPurchaseOrderFile(null);
    setPurchaseOrderUrl(null);
    setCarrier(null);
    setShippingCostTotal("");
    setShippingIncluded(true);
    setShippingPaymentMethod("TRANSFER");
    setJustification("");
    setDraftRestored(false);
  }

  function discardDraft() {
    localStorage.removeItem(DRAFT_KEY);
    resetForm();
    setErr("");
  }

  const lineTotals = lines.map((l) => (Number(l.quantity) || 0) * (Number(l.unitCost) || 0));
  const totalQty = lines.reduce((s, l) => s + (Number(l.quantity) || 0), 0);
  const total = lineTotals.reduce((s, t) => s + t, 0);

  // Cada línea se compara contra SU propio historial — el envío (si no está
  // incluido) se reparte proporcionalmente por cantidad, igual que hace el
  // servidor, para que la vista previa coincida con lo que de verdad valida.
  const overThresholdLines = lines
    .map((l, i) => {
      if (!l.stats || l.stats.last3Avg === null) return null;
      const qty = Number(l.quantity) || 0;
      const cost = Number(l.unitCost) || 0;
      const lineShipping = shippingIncluded || !shippingCostTotal || totalQty === 0 ? 0 : (Number(shippingCostTotal) * qty) / totalQty;
      const effCost = cost + (qty > 0 ? lineShipping / qty : 0);
      return effCost > l.stats.last3Avg ? { idx: i, name: l.catalogItem?.name ?? "?", effCost, last3Avg: l.stats.last3Avg } : null;
    })
    .filter((x): x is { idx: number; name: string; effCost: number; last3Avg: number } => x !== null);
  const overThreshold = overThresholdLines.length > 0;

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

  async function handlePurchaseOrderFile(file: File) {
    setPurchaseOrderFile(file);
    setUploadingPurchaseOrder(true);
    setErr("");
    const compressed = await compressImage(file);
    const uploaded = await uploadFile(compressed, "purchase-orders");
    setUploadingPurchaseOrder(false);
    if (!uploaded.ok) {
      setErr(uploaded.error);
      return;
    }
    setPurchaseOrderUrl(uploaded.url);
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
  // Confirmado 2026-07-31: cuando la IA no encuentra nombre de producto en la
  // cotización, solo un código, la orden de compra pasa a ser obligatoria —
  // es el único respaldo real de qué se está comprando y solicitando pagar.
  const needsPurchaseOrder = !!verifyResult?.referenceCodeFound && !verifyResult?.productNameFound;
  const validLines = lines.filter((l) => l.catalogItem && Number(l.quantity) > 0 && Number(l.unitCost) > 0);

  async function submit() {
    if (validLines.length === 0 || validLines.length !== lines.length || !supplier || !quoteImageUrl) {
      setErr("Completa producto, mercadería o insumo, cantidad y costo de cada línea, el proveedor, y la cotización.");
      return;
    }
    if (!quoteVerified) {
      setErr("Verifica la cotización antes de enviar.");
      return;
    }
    if (needsPurchaseOrder && !purchaseOrderUrl) {
      setErr("La cotización solo trae un código, sin nombre de producto — sube la orden de compra antes de enviar.");
      return;
    }
    if (!shippingIncluded && !carrier) {
      setErr("Elige el transportista, ya que el envío no está incluido.");
      return;
    }
    if (overThreshold && !justification.trim()) {
      setErr("Uno o más productos están por encima del historial — agrega una justificación.");
      return;
    }
    setBusy(true);
    setErr("");
    const res = await fetch("/api/purchase-requests", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        items: lines.map((l) => ({ catalogItemId: l.catalogItem!.id, quantity: Number(l.quantity), unitCost: Number(l.unitCost) })),
        supplierId: supplier.id,
        quoteImageUrl,
        quoteReadTotal: verifyResult?.readTotal ?? null,
        quoteReferenceCode: verifyResult?.referenceCodeFound ?? null,
        purchaseOrderUrl,
        deptId,
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
    localStorage.removeItem(DRAFT_KEY);
    resetForm();
    router.refresh();
  }

  return (
    <div className="bg-surface border border-rule rounded-md p-4.5">
      {draftRestored && (
        <div className="flex items-center justify-between gap-3 bg-teal/10 border border-teal/35 rounded-md px-3.5 py-2.5 mb-4">
          <div className="flex items-center gap-2 text-[12.5px] text-teal">
            <Clock size={15} /> Retomando tu solicitud sin terminar — no se perdió nada.
          </div>
          <button type="button" className="text-[11.5px] text-steel font-semibold cursor-pointer whitespace-nowrap" onClick={discardDraft}>
            Descartar y empezar de nuevo
          </button>
        </div>
      )}

      <label className="block mb-1.5 text-[10px] font-semibold uppercase tracking-wide text-steel">Productos</label>
      <div className="flex flex-col gap-3 mb-2">
        {lines.map((line, idx) => (
          <div key={idx} className="bg-surface2 border border-rule rounded-md p-3">
            <div className="flex items-start gap-2 mb-2.5">
              <div className="flex-1 min-w-0">
                <PurchaseCatalogPicker value={line.catalogItem} onChange={(item) => setLineCatalogItem(idx, item)} />
              </div>
              {lines.length > 1 && (
                <button type="button" className="text-steel hover:text-red cursor-pointer p-1.5" onClick={() => removeLine(idx)} title="Quitar producto">
                  <X size={15} />
                </button>
              )}
            </div>

            {line.stats && line.stats.count > 0 && (
              <div className="grid grid-cols-3 gap-2 mb-2.5">
                <div className="bg-cloud border border-rule rounded p-2 text-center">
                  <div className="text-[8.5px] uppercase text-steel">Más bajo</div>
                  <div className="text-[13px] font-bold text-green">${line.stats.min?.toFixed(2)}</div>
                </div>
                <div className="bg-cloud border border-rule rounded p-2 text-center">
                  <div className="text-[8.5px] uppercase text-steel">Promedio</div>
                  <div className="text-[13px] font-bold text-teal">${line.stats.avg?.toFixed(2)}</div>
                </div>
                <div className="bg-cloud border border-rule rounded p-2 text-center">
                  <div className="text-[8.5px] uppercase text-steel">Más alto</div>
                  <div className="text-[13px] font-bold text-red">${line.stats.max?.toFixed(2)}</div>
                </div>
              </div>
            )}
            {line.catalogItem && (!line.stats || line.stats.count === 0) && (
              <div className="text-[11px] text-steel mb-2.5">🆕 Sin historial previo — primera vez que se compra este producto, mercadería o insumo.</div>
            )}

            <div className="grid grid-cols-3 gap-2.5">
              <div>
                <label className="block mb-1 text-[10px] font-semibold uppercase tracking-wide text-steel">Cantidad</label>
                <input type="number" min="1" className="w-full rounded border border-rule px-2.5 py-2 text-[13px]" value={line.quantity} onChange={(e) => updateLine(idx, { quantity: e.target.value })} />
              </div>
              <div>
                <label className="block mb-1 text-[10px] font-semibold uppercase tracking-wide text-steel">Costo/unidad</label>
                <input type="number" min="0" step="0.01" className="w-full rounded border border-rule px-2.5 py-2 text-[13px]" value={line.unitCost} onChange={(e) => updateLine(idx, { unitCost: e.target.value })} />
              </div>
              <div>
                <label className="block mb-1 text-[10px] font-semibold uppercase tracking-wide text-steel">Subtotal</label>
                <div className="rounded border border-rule px-2.5 py-2 text-[13px] font-bold bg-cloud">${lineTotals[idx].toFixed(2)}</div>
              </div>
            </div>
          </div>
        ))}
      </div>
      <button type="button" className="flex items-center gap-1.5 text-[12px] text-blue font-semibold cursor-pointer mb-3.5" onClick={addLine}>
        <Plus size={13} /> Agregar otro producto de esta misma cotización
      </button>

      <div className="mb-3.5">
        <label className="block mb-1.5 text-[10px] font-semibold uppercase tracking-wide text-steel">Proveedor</label>
        <PurchaseSupplierPicker type="SUPPLIER" value={supplier} onChange={setSupplier} label="Buscar o registrar proveedor" />
      </div>

      <div className="mb-3.5">
        <label className="block mb-1.5 text-[10px] font-semibold uppercase tracking-wide text-steel">
          Cotización <span className="text-steel-dim normal-case font-normal">— total de todos los productos: ${total.toFixed(2)}</span>
        </label>
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
                Escrito ({lines.length} {lines.length === 1 ? "producto" : "productos"}): <b className="text-ink">${total.toFixed(2)}</b>
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
                    {verifyResult.suggestedCatalogItem && (
                      <div className="text-[11.5px] text-steel mb-2">
                        Ese código ya está guardado como <b className="text-ink">{verifyResult.suggestedCatalogItem.name}</b> en el catálogo.
                      </div>
                    )}
                    {!manualCodeConfirm ? (
                      <button type="button" className="rounded border border-teal bg-teal px-3 py-1.5 text-[11.5px] font-bold text-navy cursor-pointer" onClick={() => setManualCodeConfirm(true)}>
                        ✓ Sí, confirmo a qué producto(s) corresponde
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

      <div className="mb-3.5">
        <label className="block mb-1.5 text-[10px] font-semibold uppercase tracking-wide text-steel">
          Orden de compra{" "}
          {needsPurchaseOrder ? (
            <span className="text-red normal-case font-semibold">— obligatoria</span>
          ) : (
            <span className="text-steel-dim normal-case font-normal">(opcional — puedes subirla por adelantado)</span>
          )}
        </label>
        {needsPurchaseOrder && (
          <div className="text-[11.5px] text-red mb-2">
            La cotización solo trae un código, sin nombre de producto — sube la orden de compra para respaldar qué se está comprando.
          </div>
        )}
        {!purchaseOrderUrl ? (
          <label
            tabIndex={0}
            onPaste={onPastePurchaseOrder}
            className={`flex items-center justify-center gap-2 border-[1.5px] border-dashed rounded-md py-3.5 cursor-pointer text-[12.5px] focus:outline-none ${
              needsPurchaseOrder ? "border-red/45 text-red hover:border-red" : "border-rule text-steel hover:border-teal focus:border-teal"
            }`}
          >
            {uploadingPurchaseOrder ? <span className="w-4 h-4 rounded-full border-2 border-rule border-t-teal animate-spin" /> : <Upload size={15} />}
            Subir o pegar la orden de compra
            <input type="file" accept="image/*,application/pdf" className="hidden" onChange={(e) => e.target.files?.[0] && handlePurchaseOrderFile(e.target.files[0])} />
          </label>
        ) : (
          <div className="flex items-center gap-3 bg-cloud border border-rule rounded-md p-3">
            {/\.pdf($|\?)/i.test(purchaseOrderUrl) ? (
              <FileText size={22} className="text-steel shrink-0" />
            ) : (
              <img src={purchaseOrderUrl} alt="" className="w-11 h-11 rounded object-cover border border-rule shrink-0" />
            )}
            <div className="flex-1 flex items-center gap-1.5 text-[12px] text-teal">
              <CheckCircle2 size={13} /> Orden de compra subida
            </div>
            <button type="button" className="text-[11px] text-steel cursor-pointer" onClick={() => { setPurchaseOrderFile(null); setPurchaseOrderUrl(null); }}>
              Cambiar
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
          {lines.length > 1 && (
            <div className="text-[10.5px] text-steel mt-2">El costo de envío se reparte entre los productos según la cantidad de cada uno.</div>
          )}
        </div>
      )}

      {overThreshold && (
        <div className="bg-red/10 border-[1.5px] border-red/45 rounded-md p-3.5 mb-3.5">
          <div className="flex items-center gap-1.5 text-[13px] font-bold text-red mb-1">
            <AlertTriangle size={14} /> Precio por encima del historial
          </div>
          <div className="text-[12px] text-steel mb-2.5">
            {overThresholdLines.map((l) => (
              <div key={l.idx}>
                <b className="text-ink">{l.name}</b>: ${l.effCost.toFixed(2)} por unidad, supera el promedio de ${l.last3Avg.toFixed(2)}.
              </div>
            ))}
            No se puede enviar sin explicar por qué.
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
