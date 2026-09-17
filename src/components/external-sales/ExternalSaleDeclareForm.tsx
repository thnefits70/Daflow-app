"use client";

import { useEffect, useRef, useState } from "react";
import { Check, ChevronDown, ChevronUp, Printer, Upload } from "lucide-react";
import { ProductMatchPicker, type MatchCatalogItem, type ProductMatchResult } from "@/components/merchandise-reentry/ProductMatchPicker";
import { ClientMatchPicker, type ClientDTO } from "@/components/external-sales/ClientMatchPicker";
import { LogisticsProviderPicker } from "@/components/external-sales/LogisticsProviderPicker";
import { uploadFile } from "@/lib/uploadFile";
import { compressImage } from "@/lib/compressImage";
import { usePasteFile } from "@/lib/usePasteFile";
import { useFormDraft } from "@/lib/useFormDraft";
import { formatDateTime } from "@/lib/formatDateTime";
import { CatalogCode } from "@/components/shared/CatalogCode";
import { saleSteps, TimelineSteps } from "@/components/external-sales/SaleTimeline";
import { B2B_MARGIN_OPTIONS, B2B_MARGIN_DEFAULT } from "@/lib/externalSalesPricingConstants";

type SaleItemDTO = {
  id: string;
  catalogItemId: string | null;
  declaredProductName: string;
  catalogItem: { name: string; photos: string[]; justCode: string | null } | null;
  quantity: number;
  unitPrice: number;
  totalAmount: number;
  marginPercentUsed: number | null;
  rejectedAt: string | null;
  rejectionReason: string | null;
  sellerReferencePhotoUrl: string | null;
};

type SaleDTO = {
  id: string;
  code: string;
  items: SaleItemDTO[];
  totalAmount: number;
  pickupPersonName: string;
  courierNote: string | null;
  freightCost: number | null;
  client: ClientDTO | null;
  isContraEntrega: boolean;
  facturaSolicitada: "SI" | "NO" | "PENDIENTE";
  reviewStatus: "PENDING" | "APPROVED" | "REJECTED";
  rejectionReason: string | null;
  paymentProofUrl: string | null;
  paymentProofName: string | null;
  paymentConfirmedAt: string | null;
  deliveredAt: string | null;
  deliveryPhotoUrl: string | null;
  returnedAt: string | null;
  returnReason: string | null;
  returnReceivedAt: string | null;
  returnConfirmedAt: string | null;
  nairobyClosedAt: string | null;
  deletedAt: string | null;
  createdAt: string;
  advisor: { name: string } | null;
  reviewedAt: string | null;
  reviewedBy: { name: string } | null;
  paymentConfirmedBy: { name: string } | null;
  invoiceUploadedAt: string | null;
  invoiceUploadedBy: { name: string } | null;
  prepReadyAt: string | null;
  prepReadyBy: { name: string } | null;
  packAssignedAt: string | null;
  packAssignedTo: { name: string } | null;
  deliveredBy: { name: string } | null;
};

// Confirmado 2026-09-14: ya no se escribe un precio a mano — se calcula
// solo según el tipo de venta (B2B/B2C) y la cantidad. marginPercent solo
// tiene efecto real en B2B (el asesor lo elige); en B2C queda sin usar.
type DraftItem = { product: MatchCatalogItem; quantity: string; marginPercent: number; sellerReferencePhotoUrl?: string | null };

// Desglose del cálculo B2C (pedido explícito de Marcos 2026-09-16, para
// verlo cada vez que consulta o declara una venta) — solo viene cuando la
// venta es con recaudo, ver computeB2CPriceBreakdown en lib/marketProduct.ts.
type B2CBreakdown = {
  bodegaUnitCost: number;
  insuranceRatePercent: number;
  priceWithInsurance: number;
  marginPercent: number;
  priceBeforeFreight: number;
  fletePromedio: number;
  priceBeforeRounding: number;
  finalPrice: number;
};

type PreviewRow = { unitPrice: number; marginPercentUsed: number; b2cBreakdown?: B2CBreakdown; costSource: "proposal" | "kardex" | "just" };

type FacturaSolicitud = "SI" | "NO" | "PENDIENTE";

type DeclareDraftData = { client: ClientDTO | null; items: DraftItem[]; pickupPersonName: string; courierNote: string; freightCost: string; facturaSolicitada: FacturaSolicitud };
function isDeclareDraftEmpty(d: DeclareDraftData) {
  return !d.client && d.items.length === 0 && !d.pickupPersonName.trim() && !d.courierNote.trim() && !d.freightCost.trim();
}

const FACTURA_SOLICITUD_OPTIONS: { value: FacturaSolicitud; label: string }[] = [
  { value: "SI", label: "Sí" },
  { value: "NO", label: "No" },
  { value: "PENDIENTE", label: "No sé todavía" },
];

function isValidQty(qty: string) {
  const n = Number(qty);
  return qty.trim() !== "" && Number.isInteger(n) && n > 0;
}

function isValidFreightCost(v: string) {
  if (v.trim() === "") return true;
  const n = Number(v);
  return Number.isFinite(n) && n >= 0;
}

// Recalcula en vivo contra el servidor (nunca se confía en un precio que
// calcule el propio navegador) cada vez que cambian los productos,
// cantidades o el margen elegido — con un pequeño debounce para no
// disparar una llamada por cada tecla.
function usePricePreview(isContraEntrega: boolean | null, items: DraftItem[]) {
  const [preview, setPreview] = useState<PreviewRow[] | null>(null);
  const [error, setError] = useState("");

  const itemsReady = isContraEntrega !== null && items.length > 0 && items.every((it) => isValidQty(it.quantity));

  useEffect(() => {
    let cancelled = false;
    const timer = setTimeout(() => {
      if (cancelled) return;
      if (!itemsReady) {
        setPreview(null);
        setError("");
        return;
      }
      fetch("/api/external-sales/price-preview", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          items: items.map((it) => ({ catalogItemId: it.product.id, quantity: Number(it.quantity), marginPercent: isContraEntrega ? undefined : it.marginPercent })),
          isContraEntrega: isContraEntrega ?? undefined,
        }),
      })
        .then(async (r) => {
          const data = await r.json().catch(() => null);
          if (cancelled) return;
          if (!r.ok) {
            setError(data?.error ?? "No se pudo calcular el precio.");
            setPreview(null);
            return;
          }
          setError("");
          setPreview(data.items);
        })
        .catch(() => {
          if (!cancelled) {
            setError("No se pudo calcular el precio.");
            setPreview(null);
          }
        });
    }, 300);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [isContraEntrega, items, itemsReady]);

  return { preview, error };
}

// Pedido explícito de Marcos 2026-09-16: quiere ver CÓMO se calculó el
// precio B2C, no solo el número final — cada paso con los montos reales de
// ese producto, en el mismo orden que hace computeB2CPriceBreakdown.
function B2CPriceBreakdownNote({ b }: { b: B2CBreakdown }) {
  return (
    <div className="mt-1 rounded border border-blue/20 bg-blue/5 px-2 py-1.5 text-[11px] text-steel leading-relaxed">
      <div className="font-semibold text-ink mb-0.5">Cómo se calculó este precio:</div>
      Costo en bodega ${b.bodegaUnitCost.toFixed(2)} + {b.insuranceRatePercent}% de seguro = ${b.priceWithInsurance.toFixed(2)}
      <br />
      ${b.priceWithInsurance.toFixed(2)} ÷ (100% − {b.marginPercent}% de ganancia) = ${b.priceBeforeFreight.toFixed(2)}
      <br />
      ${b.priceBeforeFreight.toFixed(2)} + ${b.fletePromedio.toFixed(2)} de flete promedio = ${b.priceBeforeRounding.toFixed(2)}
      <br />
      Se redondea para que termine en .99 → <span className="font-bold text-ink">${b.finalPrice.toFixed(2)}</span>
    </div>
  );
}

// Confirmado 2026-09-17, pedido explícito del usuario: respaldo TEMPORAL
// mientras se termina de cargar INVESTOCK — este precio se calculó con el
// costo promedio de Just porque el producto todavía no tiene ni propuesta
// de Jariel ni costo real en Kardex. Se quita cuando INVESTOCK quede
// completo para todos los productos.
function JustCostSourceNote() {
  return (
    <div className="mt-1 rounded border border-gold/30 bg-gold/5 px-2 py-1 text-[10.5px] text-gold leading-relaxed">
      Precio estimado con el costo promedio de Just (temporal) — este producto todavía no tiene costo real cargado en INVESTOCK.
    </div>
  );
}

// Cantidad, en unidades enteras — el precio ya no se escribe, se calcula
// solo (ver usePricePreview). En B2B, el asesor elige el margen de
// ganancia; en B2C no hay nada que elegir.
function QtyMarginFields({
  qty,
  onQtyChange,
  isContraEntrega,
  marginMode,
  marginPercent,
  onMarginChange,
}: {
  qty: string;
  onQtyChange: (v: string) => void;
  isContraEntrega: boolean;
  marginMode: "same" | "per-item";
  marginPercent: number;
  onMarginChange: (v: number) => void;
}) {
  const qtyNum = Number(qty);
  const qtyHasDecimal = qty.trim() !== "" && !Number.isNaN(qtyNum) && !Number.isInteger(qtyNum);
  const showMarginSelect = !isContraEntrega && marginMode === "per-item";

  return (
    <div className="flex gap-2.5 mb-2">
      <div className="flex-1">
        <label className="block mb-1 text-[10px] font-semibold uppercase tracking-wide text-steel">
          Cantidad <span className="normal-case font-normal text-blue">· unidades enteras</span>
        </label>
        <div className="relative">
          <span className="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 text-[13px] font-bold text-blue">#</span>
          <input
            type="number"
            min={1}
            step={1}
            inputMode="numeric"
            className="w-full rounded border border-blue/30 bg-blue/5 pl-6 pr-2.5 py-1.5 text-[13px] font-bold"
            value={qty}
            onChange={(e) => onQtyChange(e.target.value)}
          />
        </div>
        {qtyHasDecimal && <div className="text-red text-[10.5px] mt-1">La cantidad debe ser un número entero (1, 2, 3…).</div>}
      </div>
      {showMarginSelect && (
        <div className="flex-1">
          <label className="block mb-1 text-[10px] font-semibold uppercase tracking-wide text-steel">Ganancia de este producto</label>
          <select
            className="w-full rounded border border-teal/30 bg-teal/5 px-2.5 py-1.5 text-[13px] font-bold"
            value={marginPercent}
            onChange={(e) => onMarginChange(Number(e.target.value))}
          >
            {B2B_MARGIN_OPTIONS.map((m) => (
              <option key={m} value={m}>
                {m}%
              </option>
            ))}
          </select>
        </div>
      )}
    </div>
  );
}

// Formulario de "corregir un producto rechazado" — componente aparte
// (necesita su propio usePricePreview, un hook no puede llamarse dentro de
// un .map() condicional).
function FixItemForm({
  product,
  qty,
  onQtyChange,
  marginPercent,
  onMarginChange,
  isContraEntrega,
  error,
  saving,
  onCancel,
  onChangeProduct,
  onSave,
}: {
  product: MatchCatalogItem;
  qty: string;
  onQtyChange: (v: string) => void;
  marginPercent: number;
  onMarginChange: (v: number) => void;
  isContraEntrega: boolean;
  error: string;
  saving: boolean;
  onCancel: () => void;
  onChangeProduct: () => void;
  onSave: () => void;
}) {
  const draftItems: DraftItem[] = isValidQty(qty) ? [{ product, quantity: qty, marginPercent }] : [];
  const { preview, error: previewError } = usePricePreview(isContraEntrega, draftItems);
  const previewReady = !!preview && preview.length === 1;

  return (
    <div>
      <div className="flex items-center gap-2.5 bg-surface border border-rule rounded-md p-2 mb-2">
        {product.photos[0] && (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={product.photos[0]} alt={product.name} className="w-9 h-9 object-cover rounded border border-rule shrink-0" />
        )}
        <div className="flex-1 min-w-0 text-[12px] font-semibold flex items-center gap-1.5">
          <CatalogCode code={product.justCode} />
          <span className="truncate">{product.name}</span>
        </div>
        <button type="button" className="shrink-0 text-[11px] font-semibold text-blue cursor-pointer" onClick={onChangeProduct}>Cambiar</button>
      </div>
      <QtyMarginFields qty={qty} onQtyChange={onQtyChange} isContraEntrega={isContraEntrega} marginMode="per-item" marginPercent={marginPercent} onMarginChange={onMarginChange} />
      {draftItems.length > 0 && (
        <div className="text-[12px] mb-2">
          {previewReady ? (
            <>
              Precio: <span className="font-bold text-teal">${preview![0].unitPrice.toFixed(2)}</span> <span className="text-steel">({preview![0].marginPercentUsed}% de ganancia)</span>
              {preview![0].b2cBreakdown && <B2CPriceBreakdownNote b={preview![0].b2cBreakdown} />}
              {preview![0].costSource === "just" && <JustCostSourceNote />}
            </>
          ) : (
            <span className="text-steel">calculando precio…</span>
          )}
        </div>
      )}
      {(error || previewError) && <div className="text-red text-[11px] mb-1.5">{error || previewError}</div>}
      <div className="flex gap-2">
        <button type="button" className="flex-1 rounded border border-rule px-2.5 py-1.5 text-[11.5px] font-semibold cursor-pointer" onClick={onCancel}>Cancelar</button>
        <button type="button" disabled={saving || !previewReady} className="flex-1 rounded border border-teal bg-teal px-2.5 py-1.5 text-[11.5px] font-bold text-navy cursor-pointer disabled:opacity-40" onClick={onSave}>
          {saving ? "Guardando…" : "Reenviar este producto"}
        </button>
      </div>
    </div>
  );
}

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

// Confirmado 2026-09-15, pedido explícito de Marcos: para una venta donde
// coordina su propio motorizado (no pasa por el equipo de Fulfilment), él
// mismo puede confirmar la entrega acá — con la foto opcional que el
// motorizado le manda por fuera (WhatsApp), nunca una captura en vivo (no es
// él quien está viendo la entrega en persona). Dispara el mismo descuento
// real de stock que el proceso normal de Fulfilment — solo cambia quién y
// cuándo lo confirma, nunca el efecto.
function MarkDeliveredSection({ saleId, onDone }: { saleId: string; onDone: () => void }) {
  const [confirming, setConfirming] = useState(false);
  const [photoUrl, setPhotoUrl] = useState<string | null>(null);
  const [uploading, setUploading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState("");

  async function pickPhoto(file: File) {
    setUploading(true);
    const compressed = await compressImage(file);
    const result = await uploadFile(compressed, "external-sale-delivery-photos");
    setUploading(false);
    if (result.ok) setPhotoUrl(result.url);
  }

  async function confirmDelivered() {
    setSaving(true);
    setErr("");
    try {
      await postJson(`/api/external-sales/${saleId}/deliver`, { photoUrl: photoUrl ?? undefined });
      onDone();
    } catch (e) {
      setErr(e instanceof Error ? e.message : "No se pudo confirmar la entrega.");
    } finally {
      setSaving(false);
    }
  }

  if (!confirming) {
    return (
      <button type="button" className="text-[11.5px] font-bold text-teal cursor-pointer mt-1.5" onClick={() => setConfirming(true)}>
        Marcar entregado
      </button>
    );
  }

  return (
    <div className="bg-teal/5 border border-teal/30 rounded-md p-2.5 mt-1.5">
      <div className="text-[11.5px] font-semibold mb-1.5">¿El motorizado ya entregó el pedido al cliente?</div>
      <div className="text-[10.5px] text-steel mb-2">
        Foto opcional — la que te mandó el motorizado al entregar, si te la mandó. No hace falta para confirmar.
      </div>
      {photoUrl ? (
        <div className="flex items-center gap-2 mb-2">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={photoUrl} alt="" className="w-11 h-11 object-cover rounded border border-rule shrink-0" />
          <button type="button" className="text-[11px] font-semibold text-red cursor-pointer" onClick={() => setPhotoUrl(null)}>Quitar</button>
        </div>
      ) : (
        <label className="inline-flex items-center gap-1.5 rounded border border-rule px-2.5 py-1.5 text-[11.5px] font-semibold cursor-pointer mb-2">
          <Upload size={12} />
          {uploading ? "Subiendo…" : "Adjuntar foto (opcional)"}
          <input
            type="file"
            accept="image/*"
            className="hidden"
            disabled={uploading}
            onChange={(e) => { const f = e.target.files?.[0]; e.target.value = ""; if (f) pickPhoto(f); }}
          />
        </label>
      )}
      {err && <div className="text-red text-[11px] mb-1.5">{err}</div>}
      <div className="flex items-center gap-2">
        <button type="button" disabled={saving || uploading} className="rounded border border-teal bg-teal px-3 py-1.5 text-[11.5px] font-bold text-navy cursor-pointer disabled:opacity-60" onClick={confirmDelivered}>
          {saving ? "Confirmando…" : "Confirmar entrega"}
        </button>
        <button type="button" className="text-steel text-[11.5px] cursor-pointer" onClick={() => setConfirming(false)}>Cancelar</button>
      </div>
    </div>
  );
}

// Confirmado 2026-09-16, pedido explícito del usuario: si el cliente no
// quiso recibir el pedido (o lo devolvió), SOLO el asesor dueño de la
// venta lo reporta acá — reingresa el stock a INVESTOCK automático, sin
// pasar por ninguna aprobación.
function ReportReturnSection({ saleId, onDone }: { saleId: string; onDone: () => void }) {
  const [reporting, setReporting] = useState(false);
  const [reason, setReason] = useState("");
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState("");

  async function submit() {
    setSaving(true);
    setErr("");
    try {
      await postJson(`/api/external-sales/${saleId}/report-return`, { reason: reason.trim() });
      onDone();
    } catch (e) {
      setErr(e instanceof Error ? e.message : "No se pudo reportar la devolución.");
    } finally {
      setSaving(false);
    }
  }

  if (!reporting) {
    return (
      <button type="button" className="text-[11.5px] font-bold text-red cursor-pointer mt-1.5" onClick={() => setReporting(true)}>
        El cliente no recibió el pedido
      </button>
    );
  }

  return (
    <div className="bg-red/5 border border-red/30 rounded-md p-2.5 mt-1.5">
      <div className="text-[11.5px] font-semibold mb-1.5">¿Qué pasó?</div>
      <textarea
        className="w-full rounded border border-rule bg-surface px-2.5 py-1.5 text-[12px] mb-2"
        rows={2}
        placeholder="Ej: el cliente no quiso recibirlo…"
        value={reason}
        onChange={(e) => setReason(e.target.value)}
      />
      {err && <div className="text-red text-[11px] mb-1.5">{err}</div>}
      <div className="flex items-center gap-2">
        <button
          type="button"
          disabled={saving || reason.trim().length < 3}
          className="rounded border border-red bg-red px-3 py-1.5 text-[11.5px] font-bold text-white cursor-pointer disabled:opacity-40"
          onClick={submit}
        >
          {saving ? "Reportando…" : "Confirmar devolución"}
        </button>
        <button type="button" className="text-steel text-[11.5px] cursor-pointer" onClick={() => setReporting(false)}>Cancelar</button>
      </div>
    </div>
  );
}

function statusLabel(s: SaleDTO): { text: string; color: string } {
  if (s.deletedAt) return { text: `Cancelada · ${formatDateTime(s.deletedAt)}`, color: "text-red" };
  if (s.reviewStatus === "REJECTED") return { text: "Rechazada", color: "text-red" };
  if (s.reviewStatus === "PENDING") return { text: "Esperando aprobación de Bryan", color: "text-gold" };
  if (s.returnConfirmedAt) return { text: `Devuelta · ${formatDateTime(s.returnConfirmedAt)} — stock reingresado a INVESTOCK`, color: "text-red" };
  if (s.returnReceivedAt) return { text: "Devuelta — Inventario ya la recibió, esperando aprobación de Daniel", color: "text-red" };
  if (s.returnedAt) return { text: `Devuelta · ${formatDateTime(s.returnedAt)} — esperando que Inventario la reciba`, color: "text-red" };
  if (s.nairobyClosedAt) return { text: `Cerrada · ${formatDateTime(s.nairobyClosedAt)}`, color: "text-green" };
  if (!s.paymentProofUrl) return { text: "Aprobada — falta subir comprobante", color: "text-blue" };
  if (!s.paymentConfirmedAt) return { text: "Esperando que confirmen el pago", color: "text-gold" };
  if (!s.deliveredAt) return { text: `Pago confirmado · ${formatDateTime(s.paymentConfirmedAt)} — esperando entrega`, color: "text-blue" };
  return { text: `Entregado · ${formatDateTime(s.deliveredAt)} — esperando cierre de Nairoby`, color: "text-gold" };
}

// Constructor de productos, reutilizado al declarar una venta nueva y al
// corregir y reenviar una venta rechazada completa. El precio ya no se
// escribe — se calcula solo (ver usePricePreview), incluyendo el producto
// que se está por agregar, para que el asesor vea el precio ANTES de
// confirmarlo.
function ItemsEditor({
  items,
  onChange,
  searchUrl,
  isContraEntrega,
}: {
  items: DraftItem[];
  onChange: (items: DraftItem[]) => void;
  searchUrl: string;
  isContraEntrega: boolean | null;
}) {
  const [picking, setPicking] = useState(items.length === 0);
  const [draftProduct, setDraftProduct] = useState<MatchCatalogItem | null>(null);
  const [draftQty, setDraftQty] = useState("");
  const [draftMarginPercent, setDraftMarginPercent] = useState(B2B_MARGIN_DEFAULT);
  const [marginMode, setMarginMode] = useState<"same" | "per-item">("same");
  const [sameMarginPercent, setSameMarginPercent] = useState(B2B_MARGIN_DEFAULT);
  // Confirmado 2026-09-15, pedido explícito de Marcos: si el producto todavía
  // no está matriculado (sin fotos reales en el catálogo), puede adjuntar su
  // propia foto de referencia — puramente opcional, solo para que Fulfillment
  // sepa qué despachar en vez de adivinar por el nombre.
  const [draftReferencePhotoUrl, setDraftReferencePhotoUrl] = useState<string | null>(null);
  const [uploadingReferencePhoto, setUploadingReferencePhoto] = useState(false);

  const draftValid = !!draftProduct && isValidQty(draftQty);
  const previewItems: DraftItem[] = draftValid ? [...items, { product: draftProduct!, quantity: draftQty, marginPercent: draftMarginPercent }] : items;
  const { preview, error: previewError } = usePricePreview(isContraEntrega, previewItems);
  const previewReady = !!preview && preview.length === previewItems.length;

  // Modo "mismo % para toda la venta": cambiar el selector aplica ese
  // margen a TODOS los renglones ya agregados, de una — así items[i].margin
  // siempre queda listo para enviar, sin depender del modo al momento de
  // guardar.
  function setSameMarginForAll(m: number) {
    setSameMarginPercent(m);
    if (items.length > 0) onChange(items.map((it) => ({ ...it, marginPercent: m })));
  }
  function switchToSameMode() {
    setMarginMode("same");
    if (items.length > 0) onChange(items.map((it) => ({ ...it, marginPercent: sameMarginPercent })));
  }

  function addDraft() {
    if (!draftProduct || !isValidQty(draftQty)) return;
    const marginPercent = marginMode === "same" ? sameMarginPercent : draftMarginPercent;
    onChange([...items, { product: draftProduct, quantity: draftQty, marginPercent, sellerReferencePhotoUrl: draftReferencePhotoUrl }]);
    setDraftProduct(null);
    setDraftQty("");
    setDraftMarginPercent(marginMode === "same" ? sameMarginPercent : B2B_MARGIN_DEFAULT);
    setDraftReferencePhotoUrl(null);
    setPicking(false);
  }

  async function pickReferencePhoto(file: File) {
    setUploadingReferencePhoto(true);
    const compressed = await compressImage(file);
    const result = await uploadFile(compressed, "external-sale-reference-photos");
    setUploadingReferencePhoto(false);
    if (result.ok) setDraftReferencePhotoUrl(result.url);
  }

  function removeAt(i: number) {
    onChange(items.filter((_, idx) => idx !== i));
  }

  function updateQty(i: number, qty: string) {
    onChange(items.map((it, idx) => (idx === i ? { ...it, quantity: qty } : it)));
  }

  function updateMargin(i: number, m: number) {
    onChange(items.map((it, idx) => (idx === i ? { ...it, marginPercent: m } : it)));
  }

  const total = preview ? preview.slice(0, items.length).reduce((sum, p, i) => sum + (Number(items[i].quantity) || 0) * p.unitPrice, 0) : 0;

  return (
    <div className="flex flex-col gap-2.5">
      {isContraEntrega === false && (
        <div className="flex items-center gap-3 text-[11px] font-semibold">
          <label className="flex items-center gap-1 cursor-pointer">
            <input type="radio" checked={marginMode === "same"} onChange={switchToSameMode} /> Mismo % para toda la venta
          </label>
          <label className="flex items-center gap-1 cursor-pointer">
            <input type="radio" checked={marginMode === "per-item"} onChange={() => setMarginMode("per-item")} /> % por producto
          </label>
          {marginMode === "same" && (
            <select className="rounded border border-teal/30 bg-teal/5 px-2 py-1 text-[12px] font-bold" value={sameMarginPercent} onChange={(e) => setSameMarginForAll(Number(e.target.value))}>
              {B2B_MARGIN_OPTIONS.map((m) => (
                <option key={m} value={m}>
                  {m}%
                </option>
              ))}
            </select>
          )}
        </div>
      )}

      {items.length > 0 && (
        <div className="flex flex-col gap-1.5">
          {items.map((it, i) => (
            <div key={i} className="flex items-center gap-2 bg-cloud rounded-md p-2">
              {it.product.photos[0] ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={it.product.photos[0]} alt={it.product.name} className="w-9 h-9 object-cover rounded border border-rule shrink-0" />
              ) : (
                it.sellerReferencePhotoUrl && (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img src={it.sellerReferencePhotoUrl} alt={it.product.name} title="Foto de referencia que adjuntaste" className="w-9 h-9 object-cover rounded border border-gold/50 shrink-0" />
                )
              )}
              <div className="flex-1 min-w-0 text-[12px]">
                <div className="font-semibold flex items-center gap-1.5 flex-wrap min-w-0">
                  <CatalogCode code={it.product.justCode} />
                  <span className="truncate">{it.product.name}</span>
                </div>
                <div className="flex items-center gap-2">
                  <input
                    type="number"
                    min={1}
                    step={1}
                    className="w-14 rounded border border-blue/30 bg-blue/5 px-1.5 py-0.5 text-[12px] font-bold"
                    value={it.quantity}
                    onChange={(e) => updateQty(i, e.target.value)}
                  />
                  {isContraEntrega === false && marginMode === "per-item" && (
                    <select className="rounded border border-teal/30 bg-teal/5 px-1.5 py-0.5 text-[11.5px] font-bold" value={it.marginPercent} onChange={(e) => updateMargin(i, Number(e.target.value))}>
                      {B2B_MARGIN_OPTIONS.map((m) => (
                        <option key={m} value={m}>
                          {m}%
                        </option>
                      ))}
                    </select>
                  )}
                  <span className="text-steel">
                    {previewReady ? (
                      <>
                        × ${preview![i].unitPrice.toFixed(2)} = <span className="font-bold text-ink">${((Number(it.quantity) || 0) * preview![i].unitPrice).toFixed(2)}</span>
                      </>
                    ) : (
                      "calculando…"
                    )}
                  </span>
                </div>
              </div>
              <button type="button" className="shrink-0 text-[11px] font-semibold text-red cursor-pointer" onClick={() => removeAt(i)}>Quitar</button>
            </div>
          ))}
          <div className="text-[12px] font-bold">Total: ${total.toFixed(2)}</div>
        </div>
      )}

      {previewError && <div className="text-red text-[11.5px]">{previewError}</div>}

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
            <QtyMarginFields
              qty={draftQty}
              onQtyChange={setDraftQty}
              isContraEntrega={isContraEntrega ?? false}
              marginMode={marginMode}
              marginPercent={draftMarginPercent}
              onMarginChange={setDraftMarginPercent}
            />
            {/* Confirmado 2026-09-15, pedido explícito de Marcos: este producto
                no tiene ninguna foto real registrada en el catálogo — para que
                Fulfillment no despache el equivocado adivinando por el nombre,
                puede adjuntar (opcional) su propia foto de referencia. */}
            {draftProduct.photos.length === 0 && (
              <div className="mb-2">
                <label className="block mb-1 text-[10px] font-semibold uppercase tracking-wide text-steel">
                  Foto de referencia (opcional) — este producto no tiene fotos en el catálogo
                </label>
                {draftReferencePhotoUrl ? (
                  <div className="flex items-center gap-2">
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img src={draftReferencePhotoUrl} alt="" className="w-11 h-11 object-cover rounded border border-rule shrink-0" />
                    <button type="button" className="text-[11px] font-semibold text-red cursor-pointer" onClick={() => setDraftReferencePhotoUrl(null)}>Quitar</button>
                  </div>
                ) : (
                  <label className="inline-flex items-center gap-1.5 rounded border border-rule px-2.5 py-1.5 text-[11.5px] font-semibold cursor-pointer">
                    <Upload size={12} />
                    {uploadingReferencePhoto ? "Subiendo…" : "Subir foto"}
                    <input
                      type="file"
                      accept="image/*"
                      className="hidden"
                      disabled={uploadingReferencePhoto}
                      onChange={(e) => { const f = e.target.files?.[0]; e.target.value = ""; if (f) pickReferencePhoto(f); }}
                    />
                  </label>
                )}
              </div>
            )}
            {draftValid && (
              <div className="text-[12px] mb-2">
                {previewReady ? (
                  <>
                    Precio: <span className="font-bold text-teal">${preview![items.length].unitPrice.toFixed(2)}</span>{" "}
                    <span className="text-steel">({preview![items.length].marginPercentUsed}% de ganancia)</span>
                    {preview![items.length].b2cBreakdown && <B2CPriceBreakdownNote b={preview![items.length].b2cBreakdown!} />}
                    {preview![items.length].costSource === "just" && <JustCostSourceNote />}
                  </>
                ) : (
                  <span className="text-steel">calculando precio…</span>
                )}
              </div>
            )}
            <div className="flex gap-2">
              {items.length > 0 && (
                <button type="button" className="flex-1 rounded border border-rule px-2.5 py-1.5 text-[11.5px] font-semibold cursor-pointer" onClick={() => { setDraftProduct(null); setDraftQty(""); setPicking(false); }}>
                  Cancelar
                </button>
              )}
              <button type="button" disabled={!draftValid || !previewReady} className="flex-1 rounded border border-teal bg-teal px-2.5 py-1.5 text-[11.5px] font-bold text-navy cursor-pointer disabled:opacity-40" onClick={addDraft}>
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

// Confirmado 2026-09-14, pedido explícito de Marcos: poder revisar el
// precio de un producto (el que le calcula el sistema según B2B/B2C) sin
// tener que matricular un cliente primero — para cuando alguien le
// pregunta el precio antes de decidirse a comprar. Nunca declara nada,
// solo consulta el mismo cálculo que usa ItemsEditor (usePricePreview).
function PriceCheckPanel({ searchUrl, isContraEntrega }: { searchUrl: string; isContraEntrega: boolean | null }) {
  const [open, setOpen] = useState(false);
  const [product, setProduct] = useState<MatchCatalogItem | null>(null);
  const [qty, setQty] = useState("1");
  const [marginPercent, setMarginPercent] = useState(B2B_MARGIN_DEFAULT);

  const checkItems: DraftItem[] = product && isValidQty(qty) ? [{ product, quantity: qty, marginPercent }] : [];
  const { preview, error } = usePricePreview(isContraEntrega, checkItems);
  const previewReady = !!preview && preview.length === checkItems.length && checkItems.length > 0;

  function reset() {
    setProduct(null);
    setQty("1");
    setMarginPercent(B2B_MARGIN_DEFAULT);
  }

  return (
    <div className="bg-surface border border-rule rounded-md p-3.5 flex flex-col gap-3">
      <button type="button" className="flex items-center justify-between font-display font-bold text-[14px] cursor-pointer" onClick={() => setOpen((o) => !o)}>
        Consultar precio
        <span className="text-[11px] font-normal text-blue">{open ? "Ocultar" : "Ver"}</span>
      </button>
      {open && (
        <>
          <div className="text-[11.5px] text-steel -mt-1.5">Para cuando alguien te pregunta el precio de un producto — no declara ninguna venta.</div>
          {product ? (
            <>
              <div className="flex items-center gap-2.5">
                {product.photos[0] && (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img src={product.photos[0]} alt={product.name} className="w-11 h-11 object-cover rounded border border-rule shrink-0" />
                )}
                <div className="flex-1 min-w-0 text-[12.5px] font-semibold flex items-center gap-1.5">
                  <CatalogCode code={product.justCode} />
                  <span className="truncate">{product.name}</span>
                </div>
                <button type="button" className="shrink-0 text-[11px] font-semibold text-blue cursor-pointer" onClick={reset}>Cambiar</button>
              </div>
              <QtyMarginFields
                qty={qty}
                onQtyChange={setQty}
                isContraEntrega={isContraEntrega ?? false}
                marginMode="per-item"
                marginPercent={marginPercent}
                onMarginChange={setMarginPercent}
              />
              {error && <div className="text-red text-[11.5px]">{error}</div>}
              {isValidQty(qty) && (
                <div className="text-[13px]">
                  {previewReady ? (
                    <>
                      {/* Confirmado 2026-09-15, pedido explícito de Marcos: sin esta
                          etiqueta, el precio se veía igual sin importar el canal —
                          quería que quedara claro de un vistazo si lo que ve es B2B o
                          B2C, sin tener que deducirlo del % de ganancia. */}
                      <span className="font-bold uppercase text-[10.5px] tracking-wide text-blue">{isContraEntrega ? "B2C" : "B2B"}</span>{" "}
                      Precio: <span className="font-bold text-teal">${preview![0].unitPrice.toFixed(2)}</span>{" "}
                      <span className="text-steel">({preview![0].marginPercentUsed}% de ganancia) · Total {qty} un.: </span>
                      <span className="font-bold text-ink">${(Number(qty) * preview![0].unitPrice).toFixed(2)}</span>
                      {preview![0].b2cBreakdown && <B2CPriceBreakdownNote b={preview![0].b2cBreakdown} />}
                      {preview![0].costSource === "just" && <JustCostSourceNote />}
                    </>
                  ) : (
                    <span className="text-steel">calculando precio…</span>
                  )}
                </div>
              )}
            </>
          ) : (
            <ProductMatchPicker referencePhotoUrl={null} searchUrl={searchUrl} onConfirm={(r: ProductMatchResult) => setProduct(r)} />
          )}
        </>
      )}
    </div>
  );
}

export function ExternalSaleDeclareForm() {
  const [sales, setSales] = useState<SaleDTO[] | null>(null);
  const [openTimelineId, setOpenTimelineId] = useState<string | null>(null);
  const [client, setClient] = useState<ClientDTO | null>(null);
  const [items, setItems] = useState<DraftItem[]>([]);
  const [pickupPersonName, setPickupPersonName] = useState("");
  const [courierNote, setCourierNote] = useState("");
  const [freightCost, setFreightCost] = useState("");
  const [facturaSolicitada, setFacturaSolicitada] = useState<FacturaSolicitud>("PENDIENTE");
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
  const [editFreightCost, setEditFreightCost] = useState("");
  const [editFacturaSolicitada, setEditFacturaSolicitada] = useState<FacturaSolicitud>("PENDIENTE");
  const [editSaving, setEditSaving] = useState(false);
  const [editError, setEditError] = useState("");

  const [confirmDeleteSaleId, setConfirmDeleteSaleId] = useState<string | null>(null);
  const [deletingSale, setDeletingSale] = useState(false);
  const [deleteSaleError, setDeleteSaleError] = useState("");

  const [fixingItem, setFixingItem] = useState<{ saleId: string; itemId: string } | null>(null);
  const [fixProduct, setFixProduct] = useState<MatchCatalogItem | null>(null);
  const [fixQty, setFixQty] = useState("");
  const [fixMarginPercent, setFixMarginPercent] = useState(B2B_MARGIN_DEFAULT);
  const [fixSaving, setFixSaving] = useState(false);
  const [fixError, setFixError] = useState("");

  // Confirmado 2026-09-14: define si esta persona vende B2B (elige margen) o
  // B2C (margen automático). Confirmado 2026-09-16, pedido de Marcos: quien
  // tiene canOverride puede cambiarlo por cada venta (antes quedaba fijo
  // toda la sesión) — así puede declarar "sin recaudo" cuando el cliente ya
  // pagó, sin dejar de ser su modo por defecto.
  const [isContraEntrega, setIsContraEntrega] = useState<boolean | null>(null);
  const [canOverrideRecaudo, setCanOverrideRecaudo] = useState(false);
  useEffect(() => {
    fetch("/api/external-sales/my-pricing-mode")
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => {
        if (!d) return;
        setIsContraEntrega(!!d.isContraEntrega);
        setCanOverrideRecaudo(!!d.canOverride);
      });
  }, []);

  function load() {
    fetch("/api/external-sales").then((r) => r.json()).then(setSales).catch(() => setSales([]));
  }
  useEffect(load, []);

  // Guardado automático: si sale a revisar otra venta antes de terminar de
  // declarar esta, al volver encuentra cliente/productos/entrega tal como
  // los había dejado.
  const { clearDraft: clearNewSaleDraft } = useFormDraft<DeclareDraftData>(
    "external-sale-declare:new",
    { client, items, pickupPersonName, courierNote, freightCost, facturaSolicitada },
    (d) => {
      setClient(d.client);
      setItems(d.items);
      setPickupPersonName(d.pickupPersonName);
      setCourierNote(d.courierNote);
      setFreightCost(d.freightCost);
      setFacturaSolicitada(d.facturaSolicitada ?? "PENDIENTE");
    },
    isDeclareDraftEmpty,
    "Venta nueva sin terminar de declarar",
    "/area/workspace?tab=ventas-externas"
  );

  const editDraftKey = editingId ? `external-sale-edit:${editingId}` : null;
  const { clearDraft: clearEditDraft } = useFormDraft<DeclareDraftData>(
    editDraftKey,
    { client: editClient, items: editItems, pickupPersonName: editPickupPersonName, courierNote: editCourierNote, freightCost: editFreightCost, facturaSolicitada: editFacturaSolicitada },
    (d) => {
      setEditClient(d.client);
      setEditItems(d.items);
      setEditPickupPersonName(d.pickupPersonName);
      setEditCourierNote(d.courierNote);
      setEditFreightCost(d.freightCost);
      setEditFacturaSolicitada(d.facturaSolicitada ?? "PENDIENTE");
    },
    () => false,
    "Corrección de venta sin terminar",
    "/area/workspace?tab=ventas-externas"
  );

  const canSave = !!client && items.length > 0 && items.every((it) => isValidQty(it.quantity)) && pickupPersonName.trim().length > 0 && isValidFreightCost(freightCost) && !saving;

  async function save() {
    if (!client || items.length === 0) return;
    setSaving(true);
    setError("");
    try {
      await postJson("/api/external-sales", {
        clientId: client.id,
        items: items.map((it) => ({ catalogItemId: it.product.id, quantity: Number(it.quantity), marginPercent: it.marginPercent, sellerReferencePhotoUrl: it.sellerReferencePhotoUrl ?? undefined })),
        pickupPersonName: pickupPersonName.trim(),
        courierNote: courierNote.trim() || undefined,
        freightCost: freightCost.trim() ? Number(freightCost) : undefined,
        facturaSolicitada,
        isContraEntrega: canOverrideRecaudo ? !!isContraEntrega : undefined,
      });
      setClient(null);
      setItems([]);
      setPickupPersonName("");
      setCourierNote("");
      setFreightCost("");
      setFacturaSolicitada("PENDIENTE");
      clearNewSaleDraft();
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
        marginPercent: it.marginPercentUsed ?? B2B_MARGIN_DEFAULT,
        sellerReferencePhotoUrl: it.sellerReferencePhotoUrl,
      }))
    );
    setEditPickupPersonName(s.pickupPersonName);
    setEditCourierNote(s.courierNote ?? "");
    setEditFreightCost(s.freightCost != null ? String(s.freightCost) : "");
    setEditFacturaSolicitada(s.facturaSolicitada);
    setEditError("");
  }

  const canSaveEdit = !!editClient && editItems.length > 0 && editItems.every((it) => isValidQty(it.quantity)) && editPickupPersonName.trim().length > 0 && isValidFreightCost(editFreightCost) && !editSaving;

  async function saveEdit(saleId: string) {
    if (!editClient || editItems.length === 0) return;
    setEditSaving(true);
    setEditError("");
    try {
      await patchJson(`/api/external-sales/${saleId}`, {
        clientId: editClient.id,
        items: editItems.map((it) => ({ catalogItemId: it.product.id, quantity: Number(it.quantity), marginPercent: it.marginPercent, sellerReferencePhotoUrl: it.sellerReferencePhotoUrl ?? undefined })),
        pickupPersonName: editPickupPersonName.trim(),
        courierNote: editCourierNote.trim() || undefined,
        freightCost: editFreightCost.trim() ? Number(editFreightCost) : undefined,
        facturaSolicitada: editFacturaSolicitada,
      });
      clearEditDraft();
      setEditingId(null);
      load();
    } catch (e) {
      setEditError(e instanceof Error ? e.message : "No se pudo corregir la venta.");
    } finally {
      setEditSaving(false);
    }
  }

  // Confirmado 2026-09-10, pedido de Marcos: cancelar el pedido entero
  // mientras sigue esperando aprobación de Bryan (ej. se equivocó al
  // declararlo) — deja de existir para todo efecto práctico, pero queda
  // marcado en Historial con la fecha, no desaparece sin dejar rastro.
  async function deleteSale(saleId: string) {
    setDeletingSale(true);
    setDeleteSaleError("");
    try {
      const res = await fetch(`/api/external-sales/${saleId}`, { method: "DELETE" });
      const data = await res.json().catch(() => null);
      if (!res.ok) throw new Error(data?.error ?? "No se pudo cancelar el pedido.");
      setConfirmDeleteSaleId(null);
      load();
    } catch (e) {
      setDeleteSaleError(e instanceof Error ? e.message : "No se pudo cancelar el pedido.");
    } finally {
      setDeletingSale(false);
    }
  }

  function startFixItem(saleId: string, it: SaleItemDTO) {
    setFixingItem({ saleId, itemId: it.id });
    setFixProduct({ id: it.catalogItemId ?? "", name: it.catalogItem?.name ?? it.declaredProductName, justCode: it.catalogItem?.justCode ?? null, photos: it.catalogItem?.photos ?? [], pendingRegistration: false });
    setFixQty(String(it.quantity));
    setFixMarginPercent(it.marginPercentUsed ?? B2B_MARGIN_DEFAULT);
    setFixError("");
  }

  async function saveFixItem() {
    if (!fixingItem || !fixProduct) return;
    if (!isValidQty(fixQty)) return;
    setFixSaving(true);
    setFixError("");
    try {
      await patchJson(`/api/external-sales/${fixingItem.saleId}/items/${fixingItem.itemId}`, { catalogItemId: fixProduct.id, quantity: Number(fixQty), marginPercent: fixMarginPercent });
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
      <PriceCheckPanel searchUrl="/api/external-sales/catalog-search" isContraEntrega={isContraEntrega} />

      <div className="bg-surface border border-rule rounded-md p-3.5 flex flex-col gap-3">
        <div className="font-display font-bold text-[14px]">Declarar venta</div>
        <div>
          <label className="block mb-1.5 text-[10px] font-semibold uppercase tracking-wide text-steel">Cliente</label>
          <ClientMatchPicker value={client} onChange={setClient} />
        </div>
        {canOverrideRecaudo && (
          <div>
            <label className="block mb-1 text-[10px] font-semibold uppercase tracking-wide text-steel">¿Esta venta es con recaudo o sin recaudo?</label>
            <div className="flex gap-1.5">
              <button
                type="button"
                className={`flex-1 rounded border px-2 py-1.5 text-[11.5px] font-semibold cursor-pointer ${isContraEntrega === true ? "border-teal bg-teal text-navy" : "border-rule text-steel"}`}
                onClick={() => setIsContraEntrega(true)}
              >
                Con recaudo
              </button>
              <button
                type="button"
                className={`flex-1 rounded border px-2 py-1.5 text-[11.5px] font-semibold cursor-pointer ${isContraEntrega === false ? "border-teal bg-teal text-navy" : "border-rule text-steel"}`}
                onClick={() => setIsContraEntrega(false)}
              >
                Sin recaudo
              </button>
            </div>
            <div className="text-[10.5px] text-steel mt-0.5">
              Con recaudo: el motorizado cobra al cliente al entregar (precio de consumidor). Sin recaudo: el cliente ya pagó (tú eliges el margen y la factura es obligatoria).
            </div>
          </div>
        )}
        {!client ? (
          <div className="text-[11.5px] text-steel">Primero matricula o selecciona al cliente para poder declarar la venta.</div>
        ) : (
          <>
            <div>
              <label className="block mb-1.5 text-[10px] font-semibold uppercase tracking-wide text-steel">Productos</label>
              <ItemsEditor items={items} onChange={setItems} searchUrl="/api/external-sales/catalog-search" isContraEntrega={isContraEntrega} />
            </div>
            <div>
              <label className="block mb-1 text-[10px] font-semibold uppercase tracking-wide text-steel">A quién debe entregarle bodega (motorizado o cliente)</label>
              <LogisticsProviderPicker value={pickupPersonName} onChange={setPickupPersonName} />
            </div>
            <div>
              <label className="block mb-1 text-[10px] font-semibold uppercase tracking-wide text-steel">Transportadora, si no es la habitual (opcional)</label>
              <input type="text" className="w-full rounded border border-rule bg-cloud px-2.5 py-1.5 text-[12.5px]" value={courierNote} onChange={(e) => setCourierNote(e.target.value)} />
            </div>
            <div>
              <label className="block mb-1 text-[10px] font-semibold uppercase tracking-wide text-steel">Flete del motorizado, si aplica (opcional)</label>
              <input type="number" min="0" step="0.01" placeholder="$0.00" className="w-full rounded border border-rule bg-cloud px-2.5 py-1.5 text-[12.5px]" value={freightCost} onChange={(e) => setFreightCost(e.target.value)} />
              <div className="text-[10.5px] text-steel mt-0.5">Se descuenta del total para saber cuánto debe transferir el motorizado.</div>
            </div>
            {isContraEntrega && (
              <div>
                <label className="block mb-1 text-[10px] font-semibold uppercase tracking-wide text-steel">¿El cliente pidió factura?</label>
                <div className="flex gap-1.5">
                  {FACTURA_SOLICITUD_OPTIONS.map((opt) => (
                    <button
                      key={opt.value}
                      type="button"
                      className={`flex-1 rounded border px-2 py-1.5 text-[11.5px] font-semibold cursor-pointer ${facturaSolicitada === opt.value ? "border-teal bg-teal text-navy" : "border-rule text-steel"}`}
                      onClick={() => setFacturaSolicitada(opt.value)}
                    >
                      {opt.label}
                    </button>
                  ))}
                </div>
                <div className="text-[10.5px] text-steel mt-0.5">Nairoby se guía por esto para saber a cuáles clientes debe facturarles.</div>
              </div>
            )}
            {error && <div className="text-red text-[11.5px]">{error}</div>}
            <button type="button" disabled={!canSave} className="rounded border border-teal bg-teal px-3 py-2 text-[12.5px] font-bold text-navy cursor-pointer disabled:opacity-40" onClick={save}>
              {saving ? "Enviando…" : "Declarar venta"}
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
                  <div className="flex items-center gap-2 mb-1 flex-wrap">
                    <span className="font-mono text-[11px] font-bold text-teal">{s.code}</span>
                    <span className={`text-[11px] font-semibold ${status.color}`}>{status.text}</span>
                    <button
                      type="button"
                      className="flex items-center gap-0.5 text-[10.5px] font-semibold text-blue cursor-pointer ml-auto"
                      onClick={() => setOpenTimelineId(openTimelineId === s.id ? null : s.id)}
                    >
                      {openTimelineId === s.id ? <ChevronUp size={11} /> : <ChevronDown size={11} />} Trazabilidad
                    </button>
                  </div>
                  {openTimelineId === s.id && (
                    <div className="bg-cloud rounded-md p-2 mb-1.5">
                      <TimelineSteps steps={saleSteps(s)} />
                    </div>
                  )}
                  <div className="flex flex-col gap-1">
                    {s.items.map((it) => (
                      <div key={it.id}>
                        <div className="text-[12.5px] font-semibold flex items-center gap-1.5 flex-wrap">
                          {it.catalogItem && <CatalogCode code={it.catalogItem.justCode} />}
                          <span>
                            {it.catalogItem?.name ?? it.declaredProductName} — {it.quantity} un. · ${it.totalAmount.toFixed(2)}
                            {it.marginPercentUsed != null && <span className="text-[10.5px] font-normal text-steel"> ({it.marginPercentUsed}% de ganancia)</span>}
                          </span>
                        </div>
                        {s.reviewStatus === "PENDING" && !s.deletedAt && it.rejectedAt && (
                          <div className="bg-red/5 border border-red/30 rounded-md p-2 mt-1">
                            <div className="text-[11px] text-red mb-1.5">Bryan lo rechazó: {it.rejectionReason}</div>
                            {fixingItem?.itemId === it.id ? (
                              fixProduct ? (
                                <FixItemForm
                                  product={fixProduct}
                                  qty={fixQty}
                                  onQtyChange={setFixQty}
                                  marginPercent={fixMarginPercent}
                                  onMarginChange={setFixMarginPercent}
                                  isContraEntrega={isContraEntrega ?? false}
                                  error={fixError}
                                  saving={fixSaving}
                                  onCancel={() => setFixingItem(null)}
                                  onChangeProduct={() => setFixProduct(null)}
                                  onSave={saveFixItem}
                                />
                              ) : (
                                <ProductMatchPicker referencePhotoUrl={null} searchUrl="/api/external-sales/catalog-search" onConfirm={(r) => setFixProduct(r)} />
                              )
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
                  {s.freightCost != null && (
                    <div className="text-[10.5px] text-steel mt-0.5">
                      Flete: -${s.freightCost.toFixed(2)} · Monto a transferir: <span className="font-semibold text-ink">${(s.totalAmount - s.freightCost).toFixed(2)}</span>
                    </div>
                  )}
                  <div className="text-[10.5px] text-steel mt-0.5">Entrega a: {s.pickupPersonName}{s.courierNote ? ` · Transportadora: ${s.courierNote}` : ""}</div>
                  {s.client && (
                    <div className="text-[10.5px] text-steel mt-0.5">
                      Cliente: {s.client.name} · {s.client.idNumber ? `${s.client.idType === "RUC" ? "RUC" : "Cédula"}: ${s.client.idNumber} · ` : ""}Cel: {s.client.phone}
                      {s.client.email ? ` · Correo: ${s.client.email}` : ""}
                    </div>
                  )}
                  {/* Confirmado 2026-09-16, pedido explícito de Marcos: poder
                      ver/imprimir la guía de su propia venta para reenviársela
                      por WhatsApp al cliente o al motorizado (qué retirar de
                      bodega) — antes solo Inventario/Fulfillment/admin podían
                      abrirla. Ver permiso ampliado en la propia página de la
                      guía (solo el asesor DUEÑO de esta venta, no cualquiera). */}
                  {!s.deletedAt && (
                    <a
                      href={`/ventas-externas/${s.id}/guia`}
                      target="_blank"
                      rel="noreferrer"
                      className="inline-flex items-center gap-1.5 text-[10.5px] font-semibold text-blue underline mt-1"
                    >
                      <Printer size={12} /> Ver / imprimir guía
                    </a>
                  )}
                  {s.deliveryPhotoUrl && (
                    <a href={s.deliveryPhotoUrl} target="_blank" rel="noreferrer" className="block mt-1.5">
                      <div className="text-[10.5px] font-semibold text-steel mb-1">
                        Foto de entrega al motorizado{s.deliveredAt ? ` · ${formatDateTime(s.deliveredAt)}` : ""}
                      </div>
                      {/* eslint-disable-next-line @next/next/no-img-element */}
                      <img src={s.deliveryPhotoUrl} alt="Entrega al motorizado" className="w-20 h-20 object-cover rounded border border-rule" />
                    </a>
                  )}
                  {!s.deletedAt && s.reviewStatus === "APPROVED" && s.paymentConfirmedAt && !s.deliveredAt && (
                    <MarkDeliveredSection saleId={s.id} onDone={load} />
                  )}
                  {s.returnedAt ? (
                    <div className="text-[11px] text-red mt-1">Motivo: {s.returnReason}</div>
                  ) : (
                    !s.deletedAt && s.deliveredAt && !s.nairobyClosedAt && <ReportReturnSection saleId={s.id} onDone={load} />
                  )}
                  {!s.deletedAt && s.reviewStatus === "REJECTED" && s.rejectionReason && <div className="text-[11.5px] text-red mt-1">{s.rejectionReason}</div>}
                  {!s.deletedAt && (s.reviewStatus === "REJECTED" || s.reviewStatus === "PENDING") && editingId !== s.id && confirmDeleteSaleId !== s.id && (
                    <div className="flex gap-2 mt-2">
                      <button type="button" className="text-[11.5px] font-bold border border-teal text-teal rounded px-2.5 py-1.5 cursor-pointer" onClick={() => startEdit(s)}>
                        {s.reviewStatus === "REJECTED" ? "Corregir y reenviar" : "Editar"}
                      </button>
                      {s.reviewStatus === "PENDING" && (
                        <button type="button" className="text-[11.5px] font-bold border border-red text-red rounded px-2.5 py-1.5 cursor-pointer" onClick={() => { setConfirmDeleteSaleId(s.id); setDeleteSaleError(""); }}>
                          Cancelar pedido
                        </button>
                      )}
                    </div>
                  )}
                  {/* Confirmado 2026-09-17, pedido explícito de Marcos: si el
                      cliente ya no quiere el producto DESPUÉS de que Bryan
                      aprobó pero ANTES de que salga de bodega (deliveredAt
                      vacío), el asesor puede cancelarla igual — el stock
                      nunca se tocó en INVESTOCK, así que no hay nada que
                      reversar. Si ya se entregó al motorizado, esto
                      desaparece y en su lugar aplica "El cliente no recibió
                      el pedido" (devolución real, ver ReportReturnSection). */}
                  {!s.deletedAt && s.reviewStatus === "APPROVED" && !s.deliveredAt && confirmDeleteSaleId !== s.id && (
                    <div className="mt-2">
                      <button type="button" className="text-[11.5px] font-bold border border-red text-red rounded px-2.5 py-1.5 cursor-pointer" onClick={() => { setConfirmDeleteSaleId(s.id); setDeleteSaleError(""); }}>
                        Cancelar pedido
                      </button>
                    </div>
                  )}
                  {!s.deletedAt && confirmDeleteSaleId === s.id && (
                    <div className="bg-red/10 border border-red/40 rounded-md p-2.5 mt-2">
                      <div className="text-[12px] text-ink mb-1.5">
                        ¿Cancelar el pedido {s.code}? Esto no se puede deshacer.
                        {s.reviewStatus === "APPROVED" && " Si ya se estaba agrupando o embalando en bodega, se avisará que se detenga."}
                      </div>
                      {deleteSaleError && <div className="text-red text-[11px] mb-1.5">{deleteSaleError}</div>}
                      <div className="flex gap-2">
                        <button type="button" className="flex-1 rounded border border-rule px-2.5 py-1.5 text-[11.5px] font-semibold cursor-pointer" onClick={() => setConfirmDeleteSaleId(null)}>
                          No, mantener
                        </button>
                        <button type="button" disabled={deletingSale} className="flex-1 rounded border border-red bg-red px-2.5 py-1.5 text-[11.5px] font-bold text-white cursor-pointer disabled:opacity-60" onClick={() => deleteSale(s.id)}>
                          {deletingSale ? "Cancelando…" : "Sí, cancelar"}
                        </button>
                      </div>
                    </div>
                  )}
                  {!s.deletedAt && (s.reviewStatus === "REJECTED" || s.reviewStatus === "PENDING") && editingId === s.id && (
                    <div className="bg-cloud rounded-md p-2.5 mt-2 flex flex-col gap-2.5">
                      <div>
                        <label className="block mb-1 text-[10px] font-semibold uppercase tracking-wide text-steel">Cliente</label>
                        <ClientMatchPicker value={editClient} onChange={setEditClient} />
                      </div>
                      <div>
                        <label className="block mb-1 text-[10px] font-semibold uppercase tracking-wide text-steel">Productos</label>
                        <ItemsEditor items={editItems} onChange={setEditItems} searchUrl="/api/external-sales/catalog-search" isContraEntrega={isContraEntrega} />
                      </div>
                      <div>
                        <label className="block mb-1 text-[10px] font-semibold uppercase tracking-wide text-steel">A quién debe entregarle bodega</label>
                        <LogisticsProviderPicker value={editPickupPersonName} onChange={setEditPickupPersonName} />
                      </div>
                      <div>
                        <label className="block mb-1 text-[10px] font-semibold uppercase tracking-wide text-steel">Transportadora (opcional)</label>
                        <input type="text" className="w-full rounded border border-rule bg-surface px-2.5 py-1.5 text-[12px]" value={editCourierNote} onChange={(e) => setEditCourierNote(e.target.value)} />
                      </div>
                      <div>
                        <label className="block mb-1 text-[10px] font-semibold uppercase tracking-wide text-steel">Flete del motorizado (opcional)</label>
                        <input type="number" min="0" step="0.01" placeholder="$0.00" className="w-full rounded border border-rule bg-surface px-2.5 py-1.5 text-[12px]" value={editFreightCost} onChange={(e) => setEditFreightCost(e.target.value)} />
                      </div>
                      {s.isContraEntrega && (
                        <div>
                          <label className="block mb-1 text-[10px] font-semibold uppercase tracking-wide text-steel">¿El cliente pidió factura?</label>
                          <div className="flex gap-1.5">
                            {FACTURA_SOLICITUD_OPTIONS.map((opt) => (
                              <button
                                key={opt.value}
                                type="button"
                                className={`flex-1 rounded border px-2 py-1.5 text-[11px] font-semibold cursor-pointer ${editFacturaSolicitada === opt.value ? "border-teal bg-teal text-navy" : "border-rule text-steel"}`}
                                onClick={() => setEditFacturaSolicitada(opt.value)}
                              >
                                {opt.label}
                              </button>
                            ))}
                          </div>
                        </div>
                      )}
                      {editError && <div className="text-red text-[11px]">{editError}</div>}
                      <div className="flex gap-2">
                        <button type="button" className="flex-1 rounded border border-rule px-2.5 py-1.5 text-[11.5px] font-semibold cursor-pointer" onClick={() => { clearEditDraft(); setEditingId(null); }}>Cancelar</button>
                        <button type="button" disabled={!canSaveEdit} className="flex-1 rounded border border-teal bg-teal px-2.5 py-1.5 text-[11.5px] font-bold text-navy cursor-pointer disabled:opacity-40" onClick={() => saveEdit(s.id)}>
                          {editSaving ? "Guardando…" : s.reviewStatus === "REJECTED" ? "Reenviar a Bryan" : "Guardar cambios"}
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
