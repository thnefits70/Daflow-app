"use client";

import { useState, useEffect, useRef } from "react";
import { ShoppingBag, Camera, Plus, X, Landmark, Copy } from "lucide-react";
import { LiveCameraCapture } from "@/components/shared/LiveCameraCapture";
import { ProofPreview } from "@/components/shared/ProofPreview";
import { ProductMatchPicker, type ProductMatchResult } from "@/components/merchandise-reentry/ProductMatchPicker";
import { usePasteFile } from "@/lib/usePasteFile";
import { uploadFile } from "@/lib/uploadFile";
import { formatDateTime } from "@/lib/formatDateTime";
import { CatalogCode } from "@/components/shared/CatalogCode";

type BuyerRelation = "SELF" | "MINOR_CHILD" | "OTHER_FAMILY";
type Declaration = { relation: BuyerRelation; note?: string };
type DraftItem = {
  employeeProductName: string;
  catalogItemId: string | null;
  catalogItemJustCode: string | null;
  quantity: number;
  livePhotoUrl: string | null;
  optionalPhotoUrl: string | null;
  unitDeclarations: Declaration[];
};
type CartItem = DraftItem & { livePhotoUrl: string };

type OrderHistory = {
  id: string;
  status: string;
  rejectionReason: string | null;
  totalAmount: number | null;
  installments: number;
  createdAt: string;
  paymentMethod: "PAYROLL" | "TRANSFER" | null;
  transferDeadlineAt: string | null;
  transferProofUrl: string | null;
  transferProofName: string | null;
  transferAiMatch: boolean | null;
  pickedUpAt: string | null;
  items: { employeeProductName: string; confirmedProductName: string | null; quantity: number; catalogItem: { justCode: string | null } | null; confirmedCatalogItem: { justCode: string | null } | null }[];
};

type CompanyBankAccount = {
  bankName: string | null;
  bankAccountType: string | null;
  bankAccountNumber: string | null;
  bankAccountHolder: string | null;
  holderIdType: "RUC" | "CEDULA" | null;
  holderIdNumber: string | null;
} | null;

function money(n: number) {
  return `$${n.toFixed(2)}`;
}

function deadlineText(iso: string) {
  return new Date(iso).toLocaleDateString("es-EC", { day: "numeric", month: "short" });
}

const STATUS_LABEL: Record<string, { label: string; color: string }> = {
  PENDING_INVENTORY: { label: "Esperando confirmación de bodega", color: "#D9A441" },
  PENDING_FINANCE: { label: "Bodega confirmó — falta que Nairoby cierre el precio", color: "#1E5EFF" },
  PENDING_PAYMENT_METHOD: { label: "Elegí cómo pagarla", color: "#D9A441" },
  PENDING_TRANSFER_PROOF: { label: "Falta que subas el comprobante", color: "#D9A441" },
  PENDING_ADMIN_CONFIRM: { label: "Comprobante en revisión", color: "#1E5EFF" },
  PENDING_NAIROBY_CLOSE: { label: "Transferencia confirmada — cerrando", color: "#1E5EFF" },
  APPROVED: { label: "Aprobada", color: "#22C55E" },
  REJECTED: { label: "Rechazada", color: "#C4453A" },
};

const RELATION_OPTIONS: [BuyerRelation, string][] = [
  ["SELF", "Para mí"],
  ["MINOR_CHILD", "Mi hijo/a menor de 18"],
  ["OTHER_FAMILY", "Otra persona"],
];

function emptyDraft(): DraftItem {
  return { employeeProductName: "", catalogItemId: null, catalogItemJustCode: null, quantity: 1, livePhotoUrl: null, optionalPhotoUrl: null, unitDeclarations: [{ relation: "SELF" }] };
}

// Confirmado 2026-08-19: pedido explícito del usuario tras probarlo real —
// antes había que tocar "Agregar al pedido" SÍ o SÍ antes de que se
// habilitara "Enviar compra", y no quedaba claro por qué el botón seguía
// gris. Ahora, si solo hay un producto, alcanza con completarlo y enviar
// directo — "Agregar al pedido" queda solo para sumar más de uno. Y si
// falta algo, se dice exactamente qué.
function draftMissingReason(d: DraftItem): string | null {
  if (!d.employeeProductName.trim()) return "Falta elegir el producto.";
  if (!d.livePhotoUrl) return "Falta tomar la foto en vivo del producto.";
  const missingNote = d.unitDeclarations.find((decl) => decl.relation !== "SELF" && !decl.note?.trim());
  if (missingNote) return "Falta escribir para quién es la unidad que no es para vos.";
  return null;
}

// Confirmado 2026-08-20: pegar (Ctrl+V) el comprobante de la transferencia —
// mismo mecanismo que ya usa Pagos administrativos (usePasteFile), no es
// una foto en vivo. Componente aparte porque usePasteFile es un hook y no
// puede llamarse dentro de un .map().
function TransferProofUploader({ orderId, onSent }: { orderId: string; onSent: () => void }) {
  const [proofUrl, setProofUrl] = useState<string | null>(null);
  const [proofName, setProofName] = useState<string | null>(null);
  const [uploading, setUploading] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [err, setErr] = useState("");

  async function handleFile(file: File) {
    setUploading(true);
    setErr("");
    const res = await uploadFile(file, "personal-purchase-proofs");
    setUploading(false);
    if (!res.ok) { setErr(res.error); return; }
    setProofUrl(res.url);
    setProofName(res.name);
  }
  const { onPaste, onMouseEnter, onMouseLeave } = usePasteFile(handleFile);

  async function submit() {
    if (!proofUrl) return;
    setSubmitting(true);
    setErr("");
    const res = await fetch(`/api/personal-purchases/${orderId}/transfer-proof`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ proofUrl, proofName }),
    });
    setSubmitting(false);
    if (!res.ok) { setErr("No se pudo enviar el comprobante — intentá de nuevo."); return; }
    onSent();
  }

  return (
    <div onMouseEnter={onMouseEnter} onMouseLeave={onMouseLeave} onPaste={onPaste} className="mt-2.5">
      <div className="text-[10px] font-semibold uppercase tracking-wide text-steel mb-1.5">Comprobante — Ctrl+V para pegar</div>
      {proofUrl ? (
        <div className="flex items-center gap-2">
          <ProofPreview url={proofUrl} filename={proofName ?? undefined} />
          <button type="button" className="text-[11px] text-steel-dim underline cursor-pointer" onClick={() => { setProofUrl(null); setProofName(null); }}>Quitar</button>
        </div>
      ) : (
        <label className="flex items-center justify-center gap-1.5 text-[11.5px] text-steel-dim border-[1.5px] border-dashed border-rule rounded-md px-3 py-4 cursor-pointer text-center">
          {uploading ? "Subiendo…" : "Pegá con Ctrl+V, o hacé clic para elegir un archivo"}
          <input type="file" accept="image/*,application/pdf" className="hidden" onChange={(e) => e.target.files?.[0] && handleFile(e.target.files[0])} />
        </label>
      )}
      {err && <div className="text-red text-[11.5px] mt-1.5">{err}</div>}
      <button type="button" disabled={!proofUrl || submitting} className="text-[12px] font-bold bg-teal text-white rounded-md px-3.5 py-1.5 cursor-pointer disabled:opacity-40 mt-2.5" onClick={submit}>
        {submitting ? "Enviando…" : "Enviar comprobante"}
      </button>
    </div>
  );
}

// Confirmado 2026-08-18: rediseño completo — el colaborador arma un
// pedido con uno o varios productos (carrito). Por producto: foto en vivo
// obligatoria + una segunda opcional que no ocupa espacio salvo que la
// pidan, cantidad, y hasta 3 unidades declaradas (para quién es cada una).
// Nunca se muestra ningún precio acá — el colaborador solo se entera del
// monto por notificación push cuando Nairoby cierra el precio.
// Ajustado 2026-08-27 (pedido de Daniel): el nombre del producto ya no se
// escribe de memoria a ciegas — se elige del mismo catálogo sincronizado
// con Just que usan Reingreso/Registro de Egresos/Ventas Externas/Guías
// Canceladas (ver ProductMatchPicker), con la opción de escribirlo a mano
// si todavía no está en el catálogo. `employeeProductName` sigue siendo el
// campo que llega al backend sin cambios — Daniel igual puede corregirlo
// en su pantalla de confirmación, pero ahora casi siempre ya llega bien.
export function PersonalPurchasesPanel() {
  const [cart, setCart] = useState<CartItem[]>([]);
  const [draft, setDraft] = useState<DraftItem>(emptyDraft());
  const [takingPhoto, setTakingPhoto] = useState<"main" | "extra" | null>(null);
  const [showExtraPhoto, setShowExtraPhoto] = useState(false);
  const [orders, setOrders] = useState<OrderHistory[] | null>(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  const [bankAccount, setBankAccount] = useState<CompanyBankAccount>(null);
  const [payBusy, setPayBusy] = useState<Record<string, boolean>>({});
  const [armedMethod, setArmedMethod] = useState<Record<string, "PAYROLL" | "TRANSFER" | "CANCEL_TO_PAYROLL" | undefined>>({});
  const armTimers = useRef<Record<string, ReturnType<typeof setTimeout>>>({});

  function loadOrders() {
    fetch("/api/personal-purchases").then((r) => (r.ok ? r.json() : [])).then(setOrders);
  }
  useEffect(loadOrders, []);
  useEffect(() => {
    fetch("/api/company-bank-account").then((r) => (r.ok ? r.json() : null)).then(setBankAccount);
  }, []);

  async function choosePaymentMethod(orderId: string, method: "PAYROLL" | "TRANSFER") {
    setPayBusy((b) => ({ ...b, [orderId]: true }));
    await fetch(`/api/personal-purchases/${orderId}/choose-payment-method`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ method }),
    });
    setPayBusy((b) => ({ ...b, [orderId]: false }));
    loadOrders();
  }

  // Confirmado 2026-08-21: si eligió transferencia por error (o cambia de
  // opinión) y todavía no subió el comprobante, puede cancelarla y pasarse
  // a rol de pago directo, sin aprobación de nadie más — mismo criterio que
  // elegir el método por primera vez.
  async function cancelTransfer(orderId: string) {
    setPayBusy((b) => ({ ...b, [orderId]: true }));
    await fetch(`/api/personal-purchases/${orderId}/cancel-transfer`, { method: "POST" });
    setPayBusy((b) => ({ ...b, [orderId]: false }));
    loadOrders();
  }

  // Confirmado 2026-08-20: elegir método de pago mueve plata real (transferencia
  // o descuento del rol), así que un solo tap no alcanza — el primer tap arma
  // la opción ("¿Confirmar?") y solo el segundo tap sobre la misma la ejecuta.
  // Tocar la otra opción, o no confirmar en unos segundos, desarma sin efecto.
  function handlePaymentMethodTap(orderId: string, method: "PAYROLL" | "TRANSFER") {
    if (armTimers.current[orderId]) {
      clearTimeout(armTimers.current[orderId]);
      delete armTimers.current[orderId];
    }
    if (armedMethod[orderId] === method) {
      setArmedMethod((a) => ({ ...a, [orderId]: undefined }));
      choosePaymentMethod(orderId, method);
      return;
    }
    setArmedMethod((a) => ({ ...a, [orderId]: method }));
    armTimers.current[orderId] = setTimeout(() => {
      setArmedMethod((a) => ({ ...a, [orderId]: undefined }));
      delete armTimers.current[orderId];
    }, 4000);
  }

  function handleCancelTransferTap(orderId: string) {
    if (armTimers.current[orderId]) {
      clearTimeout(armTimers.current[orderId]);
      delete armTimers.current[orderId];
    }
    if (armedMethod[orderId] === "CANCEL_TO_PAYROLL") {
      setArmedMethod((a) => ({ ...a, [orderId]: undefined }));
      cancelTransfer(orderId);
      return;
    }
    setArmedMethod((a) => ({ ...a, [orderId]: "CANCEL_TO_PAYROLL" }));
    armTimers.current[orderId] = setTimeout(() => {
      setArmedMethod((a) => ({ ...a, [orderId]: undefined }));
      delete armTimers.current[orderId];
    }, 4000);
  }

  function setQuantity(q: number) {
    const quantity = Math.max(1, q);
    setDraft((d) => {
      const capped = Math.min(quantity, 3);
      const decl = d.unitDeclarations.slice(0, capped);
      while (decl.length < capped) decl.push({ relation: "SELF" });
      return { ...d, quantity, unitDeclarations: decl };
    });
  }

  function setDeclaration(idx: number, patch: Partial<Declaration>) {
    setDraft((d) => {
      const decl = [...d.unitDeclarations];
      decl[idx] = { ...decl[idx], ...patch };
      return { ...d, unitDeclarations: decl };
    });
  }

  function addDraftToCart() {
    if (!draft.employeeProductName.trim() || !draft.livePhotoUrl) return;
    for (const d of draft.unitDeclarations) {
      if (d.relation !== "SELF" && !d.note?.trim()) return;
    }
    setCart((c) => [...c, draft as CartItem]);
    setDraft(emptyDraft());
    setShowExtraPhoto(false);
  }

  function removeFromCart(idx: number) {
    setCart((c) => c.filter((_, i) => i !== idx));
  }

  const canAddDraft = draft.employeeProductName.trim().length > 0 && !!draft.livePhotoUrl && draft.unitDeclarations.every((d) => d.relation === "SELF" || d.note?.trim());

  async function submitOrder() {
    // El producto que está a medio completar en el formulario se suma solo
    // al envío si ya está completo — así no hace falta el clic de más de
    // "Agregar al pedido" cuando es un solo producto.
    const items = canAddDraft ? [...cart, draft] : cart;
    if (items.length === 0) return;
    setBusy(true);
    setErr("");
    const res = await fetch("/api/personal-purchases", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ items }),
    });
    setBusy(false);
    const data = await res.json().catch(() => null);
    if (!res.ok) { setErr(data?.error ?? "No se pudo enviar — intentá de nuevo."); return; }
    setCart([]);
    setDraft(emptyDraft());
    setShowExtraPhoto(false);
    loadOrders();
  }

  const canSubmit = cart.length > 0 || canAddDraft;
  const submitBlockedReason = !canSubmit ? draftMissingReason(draft) : null;

  return (
    <div>
      <div className="bg-surface border border-rule rounded-md p-4 mb-4">
        <div className="text-[11px] font-semibold uppercase tracking-wide text-steel mb-3 flex items-center gap-1.5">
          <ShoppingBag size={13} /> Nueva compra personal
        </div>

        {cart.length > 0 && (
          <div className="flex flex-col gap-1.5 mb-3.5">
            {cart.map((it, idx) => (
              <div key={idx} className="flex items-center gap-2 text-[12.5px] bg-cloud border border-rule rounded-md px-3 py-2">
                <span className="flex-1 flex items-center gap-1.5">
                  <CatalogCode code={it.catalogItemJustCode} />
                  <span>{it.employeeProductName} × {it.quantity}</span>
                </span>
                <button type="button" className="text-steel-dim cursor-pointer" onClick={() => removeFromCart(idx)}>
                  <X size={13} />
                </button>
              </div>
            ))}
          </div>
        )}

        <div className="flex flex-col gap-3 border-t border-rule pt-3.5">
          <div>
            <label className="block mb-1 text-[10px] font-semibold uppercase tracking-wide text-steel">Producto</label>
            {draft.employeeProductName ? (
              <div className="flex items-center gap-2.5 bg-cloud border border-rule rounded-md px-2.5 py-2">
                <span className="flex-1 min-w-0 text-[13px] font-medium flex items-center gap-1.5">
                  <CatalogCode code={draft.catalogItemJustCode} />
                  <span className="truncate">{draft.employeeProductName}</span>
                </span>
                <button
                  type="button"
                  className="text-[11px] font-semibold text-blue cursor-pointer shrink-0"
                  onClick={() => setDraft((d) => ({ ...d, employeeProductName: "", catalogItemId: null, catalogItemJustCode: null }))}
                >
                  Cambiar
                </button>
              </div>
            ) : (
              <ProductMatchPicker
                referencePhotoUrl={draft.livePhotoUrl}
                searchUrl="/api/personal-purchases/catalog-search"
                onConfirm={(r: ProductMatchResult) => setDraft((d) => ({ ...d, employeeProductName: r.name, catalogItemId: r.id, catalogItemJustCode: r.justCode }))}
              />
            )}
          </div>

          <div>
            <label className="block mb-1 text-[10px] font-semibold uppercase tracking-wide text-steel">Cantidad</label>
            <input className="rounded border border-rule bg-cloud px-2.5 py-1.5 text-[13px] w-20" type="number" min={1} value={draft.quantity} onChange={(e) => setQuantity(Number(e.target.value))} />
          </div>

          <div className="flex flex-col gap-2">
            <label className="text-[10px] font-semibold uppercase tracking-wide text-steel">¿Para quién es cada unidad? (hasta 3 califican a precio al costo)</label>
            {draft.unitDeclarations.map((d, idx) => (
              <div key={idx} className="flex items-center gap-2 flex-wrap">
                <span className="text-[11px] text-steel-dim w-14 shrink-0">Unidad {idx + 1}</span>
                <div className="flex gap-1.5 flex-wrap">
                  {RELATION_OPTIONS.map(([v, label]) => (
                    <button key={v} type="button" onClick={() => setDeclaration(idx, { relation: v })}
                      className={`text-[11.5px] font-semibold rounded-md px-2.5 py-1 border-[1.5px] cursor-pointer ${d.relation === v ? "border-teal text-teal bg-teal/10" : "border-rule text-steel"}`}>
                      {label}
                    </button>
                  ))}
                </div>
                {d.relation !== "SELF" && (
                  <input
                    className="rounded border border-rule bg-cloud px-2 py-1 text-[12px] flex-1 min-w-[140px]"
                    placeholder={d.relation === "MINOR_CHILD" ? "Nombre del hijo/a" : "Para quién es"}
                    value={d.note ?? ""}
                    onChange={(e) => setDeclaration(idx, { note: e.target.value })}
                  />
                )}
              </div>
            ))}
            {draft.quantity > 3 && <div className="text-[11px] text-steel-dim">Las unidades de la 4ª en adelante van directo a precio Dropi.</div>}
          </div>

          <div>
            <label className="block mb-1 text-[10px] font-semibold uppercase tracking-wide text-steel">Foto en vivo</label>
            {draft.livePhotoUrl ? (
              <div className="flex items-center gap-2">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={draft.livePhotoUrl} alt="Foto del producto" className="w-20 h-20 object-cover rounded-md border border-rule" />
                <button type="button" className="text-[11.5px] text-blue font-semibold cursor-pointer" onClick={() => { setDraft((d) => ({ ...d, livePhotoUrl: null })); setTakingPhoto("main"); }}>Volver a tomar</button>
              </div>
            ) : takingPhoto === "main" ? (
              <LiveCameraCapture folder="personal-purchase-photos" onCaptured={(url) => { setDraft((d) => ({ ...d, livePhotoUrl: url })); setTakingPhoto(null); }} onCancel={() => setTakingPhoto(null)} />
            ) : (
              <button type="button" className="flex items-center gap-1.5 text-[12.5px] font-bold border-[1.5px] border-rule rounded-md px-3.5 py-2 cursor-pointer" onClick={() => setTakingPhoto("main")}>
                <Camera size={14} /> Tomar foto
              </button>
            )}
          </div>

          {!showExtraPhoto && !draft.optionalPhotoUrl && (
            <button type="button" className="text-[11px] text-steel-dim underline cursor-pointer self-start" onClick={() => setShowExtraPhoto(true)}>
              + agregar otra foto (opcional)
            </button>
          )}
          {(showExtraPhoto || draft.optionalPhotoUrl) && (
            <div>
              <label className="block mb-1 text-[10px] font-semibold uppercase tracking-wide text-steel">Segunda foto (opcional)</label>
              {draft.optionalPhotoUrl ? (
                <div className="flex items-center gap-2">
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img src={draft.optionalPhotoUrl} alt="Foto extra" className="w-16 h-16 object-cover rounded-md border border-rule" />
                  <button type="button" className="text-[11px] text-steel-dim underline cursor-pointer" onClick={() => setDraft((d) => ({ ...d, optionalPhotoUrl: null }))}>Quitar</button>
                </div>
              ) : takingPhoto === "extra" ? (
                <LiveCameraCapture folder="personal-purchase-photos" onCaptured={(url) => { setDraft((d) => ({ ...d, optionalPhotoUrl: url })); setTakingPhoto(null); }} onCancel={() => setTakingPhoto(null)} />
              ) : (
                <button type="button" className="text-[11.5px] font-semibold text-blue cursor-pointer" onClick={() => setTakingPhoto("extra")}>Tomar segunda foto</button>
              )}
            </div>
          )}

          <button type="button" disabled={!canAddDraft} className="flex items-center gap-1.5 text-[12.5px] font-bold border-[1.5px] border-teal text-teal rounded-md px-3.5 py-2 cursor-pointer disabled:opacity-40 self-start" onClick={addDraftToCart}>
            <Plus size={14} /> Agregar este producto al pedido
          </button>
        </div>

        {err && <div className="text-red text-[12.5px] mt-3">{err}</div>}
        <button type="button" disabled={busy || !canSubmit} className="text-[13px] font-bold bg-blue text-white rounded-md px-4 py-2 cursor-pointer disabled:opacity-40 mt-3.5" onClick={submitOrder}>
          {busy ? "Enviando…" : `Enviar compra${cart.length > 0 ? ` (${cart.length + (canAddDraft ? 1 : 0)})` : ""}`}
        </button>
        {submitBlockedReason && <div className="text-[11.5px] text-steel-dim mt-1.5">{submitBlockedReason}</div>}
      </div>

      <div className="bg-surface border border-rule rounded-md p-4">
        <div className="text-[11px] font-semibold uppercase tracking-wide text-steel mb-3">Mis compras</div>
        {(orders?.length ?? 0) === 0 && <div className="text-steel text-[12.5px]">Todavía no registraste ninguna compra.</div>}
        <div className="flex flex-col gap-3">
          {orders?.map((o) => {
            const s = STATUS_LABEL[o.status];
            const names = o.items.map((it) => `${it.confirmedProductName ?? it.employeeProductName} × ${it.quantity}`).join(", ");
            const isBusy = !!payBusy[o.id];
            const showPickup = o.status !== "REJECTED";
            return (
              <div key={o.id} className="py-2.5 border-b border-rule last:border-0">
                <div className="flex items-center gap-3 text-[12.5px] flex-wrap">
                  <span className="font-semibold flex-1 min-w-[160px]">{names}</span>
                  {o.totalAmount != null && (
                    <span className="font-bold tabular-nums">{money(o.totalAmount)}{o.paymentMethod === "PAYROLL" && o.installments > 1 ? ` (${o.installments} cuotas)` : ""}</span>
                  )}
                  <span className="text-[10.5px] font-semibold rounded-full px-2 py-0.5" style={{ color: s.color, border: `1px solid ${s.color}` }}>{s.label}</span>
                </div>
                {o.rejectionReason && <div className="text-[11px] text-red mt-1">{o.rejectionReason}</div>}
                {showPickup && (
                  <div className="text-[11px] mt-1" style={{ color: o.pickedUpAt ? "#22C55E" : "#8b96b3" }}>
                    {o.pickedUpAt ? `✅ Listo para retirar · ${formatDateTime(o.pickedUpAt)}` : "⏳ Daniel lo está preparando"}
                  </div>
                )}

                {o.status === "PENDING_PAYMENT_METHOD" && (
                  <div className="mt-2.5">
                    {o.transferDeadlineAt && (
                      <div className="text-[10.5px] text-steel-dim mb-1.5">Si elegís transferencia, tenés hasta el {deadlineText(o.transferDeadlineAt)}.</div>
                    )}
                    <div className="flex gap-2">
                      <button
                        type="button"
                        disabled={isBusy}
                        className={`text-[12px] font-bold border-[1.5px] rounded-md px-3.5 py-1.5 cursor-pointer disabled:opacity-40 ${armedMethod[o.id] === "TRANSFER" ? "bg-teal border-teal text-white" : "border-teal text-teal"}`}
                        onClick={() => handlePaymentMethodTap(o.id, "TRANSFER")}
                      >
                        {armedMethod[o.id] === "TRANSFER" ? "Tocá de nuevo para confirmar" : "🏦 Transferencia"}
                      </button>
                      <button
                        type="button"
                        disabled={isBusy}
                        className={`text-[12px] font-bold border-[1.5px] rounded-md px-3.5 py-1.5 cursor-pointer disabled:opacity-40 ${armedMethod[o.id] === "PAYROLL" ? "bg-ink border-ink text-bg" : "border-rule text-ink"}`}
                        onClick={() => handlePaymentMethodTap(o.id, "PAYROLL")}
                      >
                        {armedMethod[o.id] === "PAYROLL" ? "Tocá de nuevo para confirmar" : "🧾 Descuento en rol"}
                      </button>
                    </div>
                    {armedMethod[o.id] && (
                      <div className="text-[10.5px] text-steel-dim mt-1.5">Volvé a tocar la misma opción para confirmar, o tocá la otra para cambiar.</div>
                    )}
                  </div>
                )}

                {o.status === "PENDING_TRANSFER_PROOF" && (
                  <div className="mt-2.5">
                    {o.transferDeadlineAt && <div className="text-[10.5px] text-steel-dim mb-1.5">Plazo: hasta el {deadlineText(o.transferDeadlineAt)}.</div>}
                    {bankAccount?.bankAccountNumber ? (
                      <div className="bg-cloud border-[1.5px] border-dashed border-teal rounded-md p-3 mb-2.5">
                        <div className="flex items-center gap-1.5 text-[10px] font-semibold uppercase tracking-wide text-teal mb-1.5">
                          <Landmark size={11} /> Cuenta DAFLOW — transferir {o.totalAmount != null ? money(o.totalAmount) : ""}
                        </div>
                        <div className="text-[12px] flex flex-col gap-0.5">
                          <div>{bankAccount.bankName} · {bankAccount.bankAccountType}</div>
                          <div className="flex items-center gap-1.5">
                            <span className="font-semibold tabular-nums">{bankAccount.bankAccountNumber}</span>
                            <button type="button" className="text-steel-dim cursor-pointer" title="Copiar número de cuenta" onClick={() => navigator.clipboard?.writeText(bankAccount.bankAccountNumber ?? "")}>
                              <Copy size={12} />
                            </button>
                          </div>
                          <div>{bankAccount.bankAccountHolder}{bankAccount.holderIdNumber ? ` · ${bankAccount.holderIdType === "RUC" ? "RUC" : "Cédula"} ${bankAccount.holderIdNumber}` : ""}</div>
                        </div>
                      </div>
                    ) : (
                      <div className="text-[11.5px] text-steel-dim mb-2.5">Todavía no está cargada la cuenta bancaria — avisale al admin.</div>
                    )}
                    <TransferProofUploader orderId={o.id} onSent={loadOrders} />
                    <div className="mt-2.5 pt-2.5 border-t border-rule">
                      <button
                        type="button"
                        disabled={isBusy}
                        className={`text-[11.5px] font-bold border-[1.5px] rounded-md px-3 py-1.5 cursor-pointer disabled:opacity-40 ${armedMethod[o.id] === "CANCEL_TO_PAYROLL" ? "bg-ink border-ink text-bg" : "border-rule text-steel-dim"}`}
                        onClick={() => handleCancelTransferTap(o.id)}
                      >
                        {armedMethod[o.id] === "CANCEL_TO_PAYROLL" ? "Tocá de nuevo para confirmar" : "🧾 Mejor descontarlo del rol"}
                      </button>
                      {armedMethod[o.id] === "CANCEL_TO_PAYROLL" && (
                        <div className="text-[10.5px] text-steel-dim mt-1.5">Cancela la transferencia y pasa a descuento en rol. Volvé a tocar para confirmar.</div>
                      )}
                    </div>
                  </div>
                )}

                {(o.status === "PENDING_ADMIN_CONFIRM" || o.status === "PENDING_NAIROBY_CLOSE") && o.transferProofUrl && (
                  <div className="mt-2.5">
                    <ProofPreview url={o.transferProofUrl} filename={o.transferProofName ?? undefined} />
                  </div>
                )}
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}
