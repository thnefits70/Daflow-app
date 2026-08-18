"use client";

import { useEffect, useState } from "react";
import { ShoppingBag, Camera } from "lucide-react";
import { LiveCameraCapture } from "@/components/shared/LiveCameraCapture";

type RetailProduct = { id: string; name: string; photo: string | null };
type BuyerRelation = "SELF" | "MINOR_CHILD" | "OTHER_FAMILY";
type Purchase = {
  id: string;
  quantity: number;
  totalAmount: number | null;
  installments: number;
  priceMode: string;
  status: string;
  rejectionReason: string | null;
  firstPayoutMonth: string | null;
  product: { name: string; photo: string | null };
  createdAt: string;
};

function money(n: number) {
  return `$${n.toFixed(2)}`;
}

const STATUS_LABEL: Record<string, { label: string; color: string }> = {
  PENDING_INVENTORY: { label: "Esperando confirmación de bodega", color: "#D9A441" },
  PENDING_FINANCE: { label: "Ya podés retirarlo — falta que Nairoby cierre el precio", color: "#1E5EFF" },
  APPROVED: { label: "Aprobada", color: "#22C55E" },
  REJECTED: { label: "Rechazada", color: "#C4453A" },
};

// Confirmado 2026-08-18 (ajustado el mismo día): el colaborador solo
// DECLARA para quién es la compra — nunca ve ni fija un monto en dólares.
// El sistema le dice si eso califica para precio al costo o Dropi y por
// qué; el precio real lo digita Nairoby después, al cerrar la compra.
export function PersonalPurchasesPanel() {
  const [products, setProducts] = useState<RetailProduct[] | null>(null);
  const [purchases, setPurchases] = useState<Purchase[] | null>(null);
  const [productId, setProductId] = useState("");
  const [quantity, setQuantity] = useState(1);
  const [buyerRelation, setBuyerRelation] = useState<BuyerRelation>("SELF");
  const [buyerNote, setBuyerNote] = useState("");
  const [preview, setPreview] = useState<{ priceMode: string; cooldownNote: string | null; ruleText: string | null } | null>(null);
  const [photoUrl, setPhotoUrl] = useState<string | null>(null);
  const [takingPhoto, setTakingPhoto] = useState(false);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");

  function loadPurchases() {
    fetch("/api/personal-purchases").then((r) => (r.ok ? r.json() : [])).then(setPurchases);
  }
  useEffect(() => {
    fetch("/api/retail-products").then((r) => (r.ok ? r.json() : [])).then(setProducts);
    loadPurchases();
  }, []);

  useEffect(() => {
    if (!productId) { setPreview(null); return; }
    fetch(`/api/personal-purchases/price-preview?productId=${productId}&buyerRelation=${buyerRelation}`)
      .then((r) => (r.ok ? r.json() : null))
      .then(setPreview);
  }, [productId, buyerRelation]);

  async function submit() {
    if (!productId || !photoUrl) return;
    setBusy(true);
    setErr("");
    const res = await fetch("/api/personal-purchases", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        productId,
        quantity,
        livePhotoUrl: photoUrl,
        buyerRelation,
        buyerNote: buyerNote.trim() || undefined,
      }),
    });
    setBusy(false);
    const data = await res.json().catch(() => null);
    if (!res.ok) { setErr(data?.error ?? "No se pudo enviar."); return; }
    setProductId(""); setQuantity(1); setBuyerRelation("SELF"); setBuyerNote(""); setPhotoUrl(null);
    loadPurchases();
  }

  if (!products) return <div className="text-steel text-[13px]">Cargando…</div>;

  return (
    <div>
      <div className="bg-surface border border-rule rounded-md p-4 mb-4">
        <div className="text-[11px] font-semibold uppercase tracking-wide text-steel mb-3 flex items-center gap-1.5">
          <ShoppingBag size={13} /> Nueva compra personal
        </div>

        <div className="flex flex-col gap-3">
          <div>
            <label className="block mb-1 text-[10px] font-semibold uppercase tracking-wide text-steel">Producto</label>
            <select className="rounded border border-rule bg-cloud px-2.5 py-2 text-[13px] w-full" value={productId} onChange={(e) => setProductId(e.target.value)}>
              <option value="">Elegí un producto…</option>
              {products.map((p) => (<option key={p.id} value={p.id}>{p.name}</option>))}
            </select>
            {products.length === 0 && <div className="text-[11px] text-steel-dim mt-1">Todavía no hay productos en el catálogo — pedile a Daniel que agregue el que buscás.</div>}
          </div>

          <div>
            <label className="block mb-1 text-[10px] font-semibold uppercase tracking-wide text-steel">¿Para quién es?</label>
            <div className="flex gap-2 flex-wrap">
              {([["SELF", "Para mí"], ["MINOR_CHILD", "Mi hijo/a menor de 18"], ["OTHER_FAMILY", "Otro familiar"]] as [BuyerRelation, string][]).map(([v, label]) => (
                <button key={v} type="button" onClick={() => setBuyerRelation(v)}
                  className={`text-[12px] font-semibold rounded-md px-3 py-1.5 border-[1.5px] cursor-pointer ${buyerRelation === v ? "border-teal text-teal bg-teal/10" : "border-rule text-steel"}`}>
                  {label}
                </button>
              ))}
            </div>
          </div>

          {buyerRelation !== "SELF" && (
            <input className="rounded border border-rule bg-cloud px-2.5 py-1.5 text-[13px]" placeholder="Contá para quién es (ej. mi hijo Juan, 8 años)" value={buyerNote} onChange={(e) => setBuyerNote(e.target.value)} />
          )}

          <div>
            <label className="block mb-1 text-[10px] font-semibold uppercase tracking-wide text-steel">Cantidad</label>
            <input className="rounded border border-rule bg-cloud px-2.5 py-1.5 text-[13px] w-20" type="number" min={1} value={quantity} onChange={(e) => setQuantity(Math.max(1, Number(e.target.value)))} />
          </div>

          {preview && (
            <div className="text-[12.5px] bg-cloud border border-rule rounded-md p-3">
              <div className="font-bold">
                Esta compra califica a <span className={preview.priceMode === "COST" ? "text-green" : "text-steel"}>{preview.priceMode === "COST" ? "precio al costo" : "precio Dropi"}</span>
              </div>
              {preview.ruleText && <div className="text-[11.5px] text-steel-dim mt-1">{preview.ruleText}</div>}
              {preview.cooldownNote && <div className="text-[11.5px] text-steel-dim mt-1">{preview.cooldownNote}</div>}
              <div className="text-[11px] text-steel-dim mt-1.5 italic">El monto en dólares lo va a confirmar Nairoby al cerrar tu compra.</div>
            </div>
          )}

          <div>
            <label className="block mb-1 text-[10px] font-semibold uppercase tracking-wide text-steel">Foto en vivo</label>
            {photoUrl ? (
              <div className="flex items-center gap-2">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={photoUrl} alt="Foto de la compra" className="w-20 h-20 object-cover rounded-md border border-rule" />
                <button type="button" className="text-[11.5px] text-blue font-semibold cursor-pointer" onClick={() => { setPhotoUrl(null); setTakingPhoto(true); }}>Volver a tomar</button>
              </div>
            ) : takingPhoto ? (
              <LiveCameraCapture folder="personal-purchase-photos" onCaptured={(url) => { setPhotoUrl(url); setTakingPhoto(false); }} onCancel={() => setTakingPhoto(false)} />
            ) : (
              <button type="button" className="flex items-center gap-1.5 text-[12.5px] font-bold border-[1.5px] border-rule rounded-md px-3.5 py-2 cursor-pointer" onClick={() => setTakingPhoto(true)}>
                <Camera size={14} /> Tomar foto
              </button>
            )}
          </div>

          {err && <div className="text-red text-[12.5px]">{err}</div>}
          <button type="button" disabled={busy || !productId || !photoUrl} className="text-[13px] font-bold bg-blue text-white rounded-md px-4 py-2 cursor-pointer disabled:opacity-40 self-start" onClick={submit}>
            {busy ? "Enviando…" : "Enviar compra"}
          </button>
        </div>
      </div>

      <div className="bg-surface border border-rule rounded-md p-4">
        <div className="text-[11px] font-semibold uppercase tracking-wide text-steel mb-3">Mis compras</div>
        {(purchases?.length ?? 0) === 0 && <div className="text-steel text-[12.5px]">Todavía no registraste ninguna compra.</div>}
        <div className="flex flex-col gap-2">
          {purchases?.map((p) => {
            const s = STATUS_LABEL[p.status];
            return (
              <div key={p.id} className="flex items-center gap-3 text-[12.5px] py-2 border-b border-rule last:border-0 flex-wrap">
                <span className="font-semibold flex-1 min-w-[140px]">{p.product.name} × {p.quantity}</span>
                <span className="font-bold tabular-nums">
                  {p.totalAmount != null ? `${money(p.totalAmount)}${p.installments > 1 ? ` (${p.installments} cuotas)` : ""}` : "Precio por confirmar"}
                </span>
                <span className="text-[10.5px] font-semibold rounded-full px-2 py-0.5" style={{ color: s.color, border: `1px solid ${s.color}` }}>{s.label}</span>
                {p.rejectionReason && <span className="text-[11px] text-red">{p.rejectionReason}</span>}
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}
