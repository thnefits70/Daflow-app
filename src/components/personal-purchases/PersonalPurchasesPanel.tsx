"use client";

import { useEffect, useState } from "react";
import { ShoppingBag, Camera } from "lucide-react";
import { LiveCameraCapture } from "@/components/shared/LiveCameraCapture";

type RetailProduct = { id: string; name: string; photo: string | null; costPrice: number; dropiPrice: number };
type BuyerRelation = "SELF" | "MINOR_CHILD" | "OTHER_FAMILY";
type Purchase = {
  id: string;
  quantity: number;
  totalAmount: number;
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
  PENDING_FINANCE: { label: "Ya podés retirarlo — falta cerrar el precio", color: "#1E5EFF" },
  APPROVED: { label: "Aprobada", color: "#22C55E" },
  REJECTED: { label: "Rechazada", color: "#C4453A" },
};

// Confirmado 2026-08-18: pantalla de autoservicio para cualquier
// colaborador — elige producto, para quién es, ve el precio calculado (se
// muestra SOLO acá, no se repite después), toma la foto en vivo, y si el
// total es >= $25 puede elegir pagarlo en 2 cuotas.
export function PersonalPurchasesPanel() {
  const [products, setProducts] = useState<RetailProduct[] | null>(null);
  const [purchases, setPurchases] = useState<Purchase[] | null>(null);
  const [productId, setProductId] = useState("");
  const [quantity, setQuantity] = useState(1);
  const [buyerRelation, setBuyerRelation] = useState<BuyerRelation>("SELF");
  const [buyerNote, setBuyerNote] = useState("");
  const [preview, setPreview] = useState<{ priceMode: string; unitPrice: number; cooldownNote: string | null } | null>(null);
  const [installments, setInstallments] = useState(1);
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

  const product = products?.find((p) => p.id === productId);
  const total = preview ? preview.unitPrice * quantity : 0;
  const canSplit = total >= 25;

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
        installments: canSplit ? installments : 1,
      }),
    });
    setBusy(false);
    const data = await res.json().catch(() => null);
    if (!res.ok) { setErr(data?.error ?? "No se pudo enviar."); return; }
    setProductId(""); setQuantity(1); setBuyerRelation("SELF"); setBuyerNote(""); setPhotoUrl(null); setInstallments(1);
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

          <div className="flex items-center gap-3">
            <div>
              <label className="block mb-1 text-[10px] font-semibold uppercase tracking-wide text-steel">Cantidad</label>
              <input className="rounded border border-rule bg-cloud px-2.5 py-1.5 text-[13px] w-20" type="number" min={1} value={quantity} onChange={(e) => setQuantity(Math.max(1, Number(e.target.value)))} />
            </div>
            {preview && product && (
              <div className="text-[13px]">
                <div className="font-bold">
                  {money(preview.unitPrice)} × {quantity} = {money(total)}
                  <span className="text-steel-dim font-normal text-[11px] ml-1.5">({preview.priceMode === "COST" ? "precio al costo" : "precio Dropi"})</span>
                </div>
                {preview.cooldownNote && <div className="text-[11px] text-steel-dim mt-0.5 max-w-md">{preview.cooldownNote}</div>}
              </div>
            )}
          </div>

          {canSplit && (
            <label className="flex items-center gap-2 text-[12.5px]">
              <input type="checkbox" checked={installments === 2} onChange={(e) => setInstallments(e.target.checked ? 2 : 1)} />
              Pagarlo en 2 cuotas (el total es {money(total)}, califica por ser ≥ $25)
            </label>
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
                <span className="font-bold tabular-nums">{money(p.totalAmount)}{p.installments > 1 ? ` (${p.installments} cuotas)` : ""}</span>
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
