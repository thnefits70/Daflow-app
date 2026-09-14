"use client";

import { useEffect, useRef, useState } from "react";
import { Check, Upload } from "lucide-react";
import { ProductMatchPicker, type MatchCatalogItem, type ProductMatchResult } from "@/components/merchandise-reentry/ProductMatchPicker";
import { ClientMatchPicker, type ClientDTO } from "@/components/external-sales/ClientMatchPicker";
import { uploadFile } from "@/lib/uploadFile";
import { usePasteFile } from "@/lib/usePasteFile";
import { useFormDraft } from "@/lib/useFormDraft";
import { formatDateTime } from "@/lib/formatDateTime";
import { CatalogCode } from "@/components/shared/CatalogCode";
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

// Confirmado 2026-09-14: ya no se escribe un precio a mano — se calcula
// solo según el tipo de venta (B2B/B2C) y la cantidad. marginPercent solo
// tiene efecto real en B2B (el asesor lo elige); en B2C queda sin usar.
type DraftItem = { product: MatchCatalogItem; quantity: string; marginPercent: number };

type PreviewRow = { unitPrice: number; marginPercentUsed: number };

type DeclareDraftData = { client: ClientDTO | null; items: DraftItem[]; pickupPersonName: string; courierNote: string };
function isDeclareDraftEmpty(d: DeclareDraftData) {
  return !d.client && d.items.length === 0 && !d.pickupPersonName.trim() && !d.courierNote.trim();
}

function isValidQty(qty: string) {
  const n = Number(qty);
  return qty.trim() !== "" && Number.isInteger(n) && n > 0;
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

function statusLabel(s: SaleDTO): { text: string; color: string } {
  if (s.deletedAt) return { text: `Cancelada · ${formatDateTime(s.deletedAt)}`, color: "text-red" };
  if (s.reviewStatus === "REJECTED") return { text: "Rechazada", color: "text-red" };
  if (s.reviewStatus === "PENDING") return { text: "Esperando aprobación de Bryan", color: "text-gold" };
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
    onChange([...items, { product: draftProduct, quantity: draftQty, marginPercent }]);
    setDraftProduct(null);
    setDraftQty("");
    setDraftMarginPercent(marginMode === "same" ? sameMarginPercent : B2B_MARGIN_DEFAULT);
    setPicking(false);
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
              {it.product.photos[0] && (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={it.product.photos[0]} alt={it.product.name} className="w-9 h-9 object-cover rounded border border-rule shrink-0" />
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
            {draftValid && (
              <div className="text-[12px] mb-2">
                {previewReady ? (
                  <>
                    Precio: <span className="font-bold text-teal">${preview![items.length].unitPrice.toFixed(2)}</span>{" "}
                    <span className="text-steel">({preview![items.length].marginPercentUsed}% de ganancia)</span>
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
  // B2C (margen automático) — se pide una sola vez, nunca cambia mientras
  // dura la sesión de este formulario.
  const [isContraEntrega, setIsContraEntrega] = useState<boolean | null>(null);
  useEffect(() => {
    fetch("/api/external-sales/my-pricing-mode").then((r) => (r.ok ? r.json() : null)).then((d) => setIsContraEntrega(d ? !!d.isContraEntrega : null));
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
    { client, items, pickupPersonName, courierNote },
    (d) => {
      setClient(d.client);
      setItems(d.items);
      setPickupPersonName(d.pickupPersonName);
      setCourierNote(d.courierNote);
    },
    isDeclareDraftEmpty
  );

  const editDraftKey = editingId ? `external-sale-edit:${editingId}` : null;
  const { clearDraft: clearEditDraft } = useFormDraft<DeclareDraftData>(
    editDraftKey,
    { client: editClient, items: editItems, pickupPersonName: editPickupPersonName, courierNote: editCourierNote },
    (d) => {
      setEditClient(d.client);
      setEditItems(d.items);
      setEditPickupPersonName(d.pickupPersonName);
      setEditCourierNote(d.courierNote);
    },
    () => false
  );

  const canSave = !!client && items.length > 0 && items.every((it) => isValidQty(it.quantity)) && pickupPersonName.trim().length > 0 && !saving;

  async function save() {
    if (!client || items.length === 0) return;
    setSaving(true);
    setError("");
    try {
      await postJson("/api/external-sales", {
        clientId: client.id,
        items: items.map((it) => ({ catalogItemId: it.product.id, quantity: Number(it.quantity), marginPercent: it.marginPercent })),
        pickupPersonName: pickupPersonName.trim(),
        courierNote: courierNote.trim() || undefined,
      });
      setClient(null);
      setItems([]);
      setPickupPersonName("");
      setCourierNote("");
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
      }))
    );
    setEditPickupPersonName(s.pickupPersonName);
    setEditCourierNote(s.courierNote ?? "");
    setEditError("");
  }

  const canSaveEdit = !!editClient && editItems.length > 0 && editItems.every((it) => isValidQty(it.quantity)) && editPickupPersonName.trim().length > 0 && !editSaving;

  async function saveEdit(saleId: string) {
    if (!editClient || editItems.length === 0) return;
    setEditSaving(true);
    setEditError("");
    try {
      await patchJson(`/api/external-sales/${saleId}`, {
        clientId: editClient.id,
        items: editItems.map((it) => ({ catalogItemId: it.product.id, quantity: Number(it.quantity), marginPercent: it.marginPercent })),
        pickupPersonName: editPickupPersonName.trim(),
        courierNote: editCourierNote.trim() || undefined,
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
              <ItemsEditor items={items} onChange={setItems} searchUrl="/api/external-sales/catalog-search" isContraEntrega={isContraEntrega} />
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
                  <div className="flex items-center gap-2 mb-1">
                    <span className="font-mono text-[11px] font-bold text-teal">{s.code}</span>
                    <span className={`text-[11px] font-semibold ${status.color}`}>{status.text}</span>
                  </div>
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
                  <div className="text-[10.5px] text-steel mt-0.5">Entrega a: {s.pickupPersonName}{s.courierNote ? ` · Transportadora: ${s.courierNote}` : ""}</div>
                  {s.client && (
                    <div className="text-[10.5px] text-steel mt-0.5">
                      Cliente: {s.client.name} · {s.client.idType === "RUC" ? "RUC" : "Cédula"}: {s.client.idNumber} · Cel: {s.client.phone}
                      {s.client.email ? ` · Correo: ${s.client.email}` : ""}
                    </div>
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
                  {!s.deletedAt && confirmDeleteSaleId === s.id && (
                    <div className="bg-red/10 border border-red/40 rounded-md p-2.5 mt-2">
                      <div className="text-[12px] text-ink mb-1.5">¿Cancelar el pedido {s.code}? Esto no se puede deshacer.</div>
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
                        <input type="text" className="w-full rounded border border-rule bg-surface px-2.5 py-1.5 text-[12px]" value={editPickupPersonName} onChange={(e) => setEditPickupPersonName(e.target.value)} />
                      </div>
                      <div>
                        <label className="block mb-1 text-[10px] font-semibold uppercase tracking-wide text-steel">Transportadora (opcional)</label>
                        <input type="text" className="w-full rounded border border-rule bg-surface px-2.5 py-1.5 text-[12px]" value={editCourierNote} onChange={(e) => setEditCourierNote(e.target.value)} />
                      </div>
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
