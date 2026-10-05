"use client";

import { useEffect, useState } from "react";
import { CheckCircle2, XCircle } from "lucide-react";
import { CatalogCode } from "@/components/shared/CatalogCode";
import { anyReasonLabel } from "@/lib/localWarrantyConstants";

type SaleItemDTO = {
  id: string;
  declaredProductName: string;
  catalogItem: { name: string; photos: string[]; justCode: string | null } | null;
  quantity: number;
  unitPrice: number;
  totalAmount: number;
  marginPercentUsed: number | null;
  rejectedAt: string | null;
  rejectionReason: string | null;
  warrantyRole: "DELIVER" | "PICKUP" | "UNRECOVERED" | null;
  warrantyReason: string | null;
  discountsStock: boolean;
};

type SaleDTO = {
  id: string;
  code: string;
  kind: "SALE" | "WARRANTY";
  items: SaleItemDTO[];
  pickupPersonName: string;
  courierNote: string | null;
  isContraEntrega: boolean;
  freightCost: number | null;
  totalAmount: number;
  advisor: { name: string } | null;
  clientName: string | null;
  clientPhone: string | null;
  deliveryAddress: string | null;
  warrantySourceGuide: string | null;
  warrantySourceCarrier: string | null;
  warrantySourceSale: { code: string } | null;
  warrantyOriginalShippedAt: string | null;
  warrantyLate: boolean;
  warrantyEvidenceUrls: string[];
};

async function postJson(url: string, body?: unknown) {
  const res = await fetch(url, { method: "POST", headers: { "Content-Type": "application/json" }, body: body ? JSON.stringify(body) : undefined });
  const data = await res.json().catch(() => null);
  if (!res.ok) throw new Error(data?.error ?? "Ocurrió un error.");
  return data;
}

export function ExternalSaleReviewInbox() {
  const [sales, setSales] = useState<SaleDTO[] | null>(null);
  const [rejecting, setRejecting] = useState<string | null>(null);
  const [reason, setReason] = useState("");
  const [rejectingItem, setRejectingItem] = useState<{ saleId: string; itemId: string } | null>(null);
  const [itemReason, setItemReason] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  function load() {
    fetch("/api/external-sales/pending-review").then((r) => r.json()).then(setSales).catch(() => setSales([]));
  }
  useEffect(load, []);

  async function approve(id: string) {
    setSaving(true);
    setError("");
    try {
      await postJson(`/api/external-sales/${id}/review`, { approved: true });
      load();
    } catch (e) {
      setError(e instanceof Error ? e.message : "No se pudo aprobar.");
    } finally {
      setSaving(false);
    }
  }

  async function reject(id: string) {
    if (!reason.trim()) return;
    setSaving(true);
    setError("");
    try {
      await postJson(`/api/external-sales/${id}/review`, { approved: false, rejectionReason: reason.trim() });
      setRejecting(null);
      setReason("");
      load();
    } catch (e) {
      setError(e instanceof Error ? e.message : "No se pudo rechazar.");
    } finally {
      setSaving(false);
    }
  }

  async function rejectItem(saleId: string, itemId: string) {
    if (!itemReason.trim()) return;
    setSaving(true);
    setError("");
    try {
      await postJson(`/api/external-sales/${saleId}/items/${itemId}/reject`, { reason: itemReason.trim() });
      setRejectingItem(null);
      setItemReason("");
      load();
    } catch (e) {
      setError(e instanceof Error ? e.message : "No se pudo rechazar el producto.");
    } finally {
      setSaving(false);
    }
  }

  if (sales === null) return <div className="text-[13px] text-steel">Cargando…</div>;
  if (sales.length === 0) return <div className="text-[13px] text-steel">No hay ventas ni garantías pendientes de revisión.</div>;

  return (
    <div className="flex flex-col gap-2.5 max-w-lg">
      {sales.map((s) => {
        const rejectedCount = s.items.filter((it) => it.rejectedAt).length;
        const total = s.items.reduce((sum, it) => sum + it.totalAmount, 0);
        const isWarranty = s.kind === "WARRANTY";
        const what = isWarranty ? "la garantía" : "toda la venta";
        return (
          <div key={s.id} className="bg-surface border border-rule rounded-md p-3.5">
            <div className="flex items-center gap-2 mb-2">
              <span className="font-mono text-[11px] font-bold text-teal">{s.code}</span>
              <span className="text-[11px] text-steel">{s.advisor?.name ?? "—"}</span>
              {isWarranty && <span className="ml-auto text-[10.5px] font-bold uppercase tracking-wide text-gold">Garantía local</span>}
            </div>

            {isWarranty ? <WarrantyDetails s={s} /> : (<>
            <div className="flex flex-col gap-2 mb-2">
              {s.items.map((it) => (
                <div key={it.id} className={`rounded-md p-2 border ${it.rejectedAt ? "bg-red/5 border-red/30" : "bg-cloud border-rule"}`}>
                  <div className="flex items-start gap-2">
                    {it.catalogItem?.photos[0] && (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img src={it.catalogItem.photos[0]} alt={it.catalogItem.name} className="w-10 h-10 object-cover rounded border border-rule shrink-0" />
                    )}
                    <div className="flex-1 min-w-0">
                      <div className="text-[12.5px] font-semibold flex items-center gap-1.5 flex-wrap">
                        {it.catalogItem && <CatalogCode code={it.catalogItem.justCode} />}
                        <span>{it.catalogItem?.name ?? it.declaredProductName}</span>
                      </div>
                    </div>
                  </div>
                  <div className="text-[11.5px] text-steel">
                    {it.quantity} un. × ${it.unitPrice.toFixed(2)} = <span className="font-bold text-ink">${it.totalAmount.toFixed(2)}</span>
                    {it.marginPercentUsed != null && <span className="ml-1.5 text-[10.5px] font-semibold text-teal">({it.marginPercentUsed}% de ganancia)</span>}
                  </div>

                  {it.rejectedAt ? (
                    <div className="text-[11px] text-red mt-1">Rechazado: {it.rejectionReason} — esperando que {s.advisor?.name ?? "el asesor"} lo corrija.</div>
                  ) : rejectingItem?.saleId === s.id && rejectingItem?.itemId === it.id ? (
                    <div className="mt-1.5">
                      <textarea
                        className="w-full rounded border border-rule bg-surface px-2 py-1 text-[11.5px] mb-1.5"
                        rows={2}
                        placeholder="Motivo del rechazo de este producto…"
                        value={itemReason}
                        onChange={(e) => setItemReason(e.target.value)}
                      />
                      <div className="flex gap-1.5">
                        <button type="button" className="flex-1 rounded border border-rule px-2 py-1 text-[11px] font-semibold cursor-pointer" onClick={() => { setRejectingItem(null); setItemReason(""); }}>Cancelar</button>
                        <button type="button" disabled={saving || !itemReason.trim()} className="flex-1 rounded border border-red bg-red px-2 py-1 text-[11px] font-bold text-white cursor-pointer disabled:opacity-40" onClick={() => rejectItem(s.id, it.id)}>
                          {saving ? "Guardando…" : "Confirmar"}
                        </button>
                      </div>
                    </div>
                  ) : (
                    <button
                      type="button"
                      className="flex items-center gap-1 text-[10.5px] font-semibold border border-red/40 text-red rounded-full px-2 py-0.5 mt-1 cursor-pointer"
                      onClick={() => { setRejectingItem({ saleId: s.id, itemId: it.id }); setItemReason(""); }}
                    >
                      <XCircle size={11} /> Rechazar este producto
                    </button>
                  )}
                </div>
              ))}
            </div>

            <div className="text-[12px] font-bold mb-1.5">Total: ${total.toFixed(2)}</div>
            {s.isContraEntrega && s.freightCost != null && (
              <div className="text-[11.5px] text-steel">Flete: -${s.freightCost.toFixed(2)} · Monto a transferir: ${(total - s.freightCost).toFixed(2)}</div>
            )}
            {!s.isContraEntrega && s.freightCost != null && (
              <div className="text-[11.5px] text-steel">Monto a transferir: ${total.toFixed(2)} (sin recaudo) · flete (${s.freightCost.toFixed(2)}) se paga aparte al motorizado</div>
            )}
            <div className="text-[11.5px] text-steel">Entrega a: {s.pickupPersonName}</div>
            {s.courierNote && <div className="text-[11.5px] text-steel">Transportadora: {s.courierNote}</div>}
            </>)}

            {rejecting === s.id ? (
              <div className="bg-cloud rounded-md p-2.5 mt-2.5">
                <textarea className="w-full rounded border border-rule bg-surface px-2.5 py-1.5 text-[12px] mb-2" rows={2} placeholder={`Motivo del rechazo de ${what}…`} value={reason} onChange={(e) => setReason(e.target.value)} />
                {error && <div className="text-red text-[11px] mb-1.5">{error}</div>}
                <div className="flex gap-2">
                  <button type="button" className="flex-1 rounded border border-rule px-2.5 py-1.5 text-[11.5px] font-semibold cursor-pointer" onClick={() => { setRejecting(null); setReason(""); }}>Cancelar</button>
                  <button type="button" disabled={saving || !reason.trim()} className="flex-1 rounded border border-red bg-red px-2.5 py-1.5 text-[11.5px] font-bold text-white cursor-pointer disabled:opacity-40" onClick={() => reject(s.id)}>
                    {saving ? "Guardando…" : "Confirmar rechazo"}
                  </button>
                </div>
              </div>
            ) : (
              <>
                {rejectedCount > 0 && <div className="text-[11px] text-gold font-semibold mt-2">Esperando que corrijan {rejectedCount} producto{rejectedCount === 1 ? "" : "s"} antes de poder aprobar toda la venta.</div>}
                {error && <div className="text-red text-[11px] mt-1.5">{error}</div>}
                <div className="flex gap-1.5 mt-2.5">
                  <button type="button" disabled={saving || rejectedCount > 0} title={rejectedCount > 0 ? "Hay productos rechazados pendientes de corrección" : undefined} className="flex items-center gap-1 text-[11.5px] font-semibold border border-green/40 text-green rounded-full px-2.5 py-1 cursor-pointer disabled:opacity-40" onClick={() => approve(s.id)}>
                    <CheckCircle2 size={12} /> Aprobar {what}
                  </button>
                  <button type="button" className="flex items-center gap-1 text-[11.5px] font-semibold border border-red/40 text-red rounded-full px-2.5 py-1 cursor-pointer" onClick={() => setRejecting(s.id)}>
                    <XCircle size={12} /> Rechazar {what}
                  </button>
                </div>
              </>
            )}
          </div>
        );
      })}
    </div>
  );
}

// Pedido del usuario 2026-10-05: Bryan aprueba las garantías locales antes de
// que salgan — ve lo que necesita para decidir: de dónde viene, el motivo de
// cada producto, las fotos/videos que revisó el asesor, qué se recoge, cobro
// y flete.
function WarrantyDetails({ s }: { s: SaleDTO }) {
  const name = (it: SaleItemDTO) => it.catalogItem?.name ?? it.declaredProductName;
  const deliver = s.items.filter((it) => it.warrantyRole === "DELIVER");
  const pickup = s.items.filter((it) => it.warrantyRole === "PICKUP");
  const unrecovered = s.items.filter((it) => it.warrantyRole === "UNRECOVERED");
  const shipped = s.warrantyOriginalShippedAt ? new Date(s.warrantyOriginalShippedAt).toLocaleDateString("es-EC", { day: "2-digit", month: "2-digit" }) : null;
  return (
    <div className="flex flex-col gap-1.5 text-[11.5px] mb-1">
      <div className="text-steel">
        De {s.warrantySourceGuide ? `la guía ${s.warrantySourceGuide}` : `la venta ${s.warrantySourceSale?.code ?? "—"}`}
        {s.warrantySourceCarrier && ` (${s.warrantySourceCarrier})`}
        {shipped && ` · salió el ${shipped}`}
        {s.warrantyLate && <span className="ml-1 font-semibold text-gold">· fuera de los 7 días (el asesor lo confirmó dos veces)</span>}
      </div>
      <div className="text-steel">
        Cliente: <span className="text-ink font-semibold">{s.clientName ?? "—"}</span>
        {s.clientPhone && ` · ${s.clientPhone}`}
        {s.deliveryAddress && ` · ${s.deliveryAddress}`}
      </div>

      <div className="flex flex-col gap-1.5 mt-1">
        {deliver.map((it) => (
          <div key={it.id} className="rounded-md p-2 border bg-cloud border-rule flex items-start gap-2">
            {it.catalogItem?.photos[0] && (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={it.catalogItem.photos[0]} alt={name(it)} className="w-10 h-10 object-cover rounded border border-rule shrink-0" />
            )}
            <div className="flex-1 min-w-0">
              <div className="text-[12.5px] font-semibold flex items-center gap-1.5 flex-wrap">
                {it.catalogItem && <CatalogCode code={it.catalogItem.justCode} />}
                <span>Entregar: {name(it)} ×{it.quantity}</span>
              </div>
              <div className="text-steel">
                Motivo: <span className="text-ink font-semibold">{anyReasonLabel(it.warrantyReason)}</span>
                {it.discountsStock ? " · sale una unidad nueva de bodega" : " · no se descuenta otra vez (ya salió en el corte)"}
              </div>
            </div>
          </div>
        ))}
      </div>
      {pickup.length > 0 && <div>El motorizado recoge: {pickup.map((it) => `${name(it)} ×${it.quantity} (${anyReasonLabel(it.warrantyReason)})`).join(" · ")}</div>}
      {unrecovered.length > 0 && <div>El cliente se queda: {unrecovered.map((it) => `${name(it)} ×${it.quantity} (${anyReasonLabel(it.warrantyReason)})`).join(" · ")} — sale del stock</div>}

      {s.warrantyEvidenceUrls.length > 0 && (
        <div className="flex flex-wrap gap-1.5 mt-1">
          {s.warrantyEvidenceUrls.map((url, i) =>
            /\.(mp4|mov|webm|m4v|3gp)(\?|$)/i.test(url) ? (
              <video key={url} src={url} controls className="w-40 h-28 rounded border border-rule bg-black" />
            ) : (
              // eslint-disable-next-line @next/next/no-img-element
              <img key={url} src={url} alt={`Evidencia ${i + 1}`} className="w-20 h-20 object-cover rounded border border-rule" />
            )
          )}
        </div>
      )}

      <div className="text-steel mt-1">
        Cobro al cliente: <span className="text-ink font-semibold">{s.totalAmount > 0 ? `$${s.totalAmount.toFixed(2)}` : "sin cobro"}</span>
        {s.freightCost != null && ` · flete $${s.freightCost.toFixed(2)} (se paga entregue o no)`}
        {` · motorizado: ${s.pickupPersonName}`}
      </div>
    </div>
  );
}
