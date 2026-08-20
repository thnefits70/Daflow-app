"use client";

import { useEffect, useState } from "react";

type Item = {
  id: string;
  confirmedProductName: string | null;
  employeeProductName: string;
  quantity: number;
  unitPriceModes: string[] | null;
  livePhotoUrl: string;
  optionalPhotoUrl: string | null;
};
type Order = {
  id: string;
  employee: { name: string };
  items: Item[];
};

function money(n: number) {
  return `$${n.toFixed(2)}`;
}

// Confirmado 2026-08-18/20: Nairoby digita el precio en dólares acá — sin
// ningún catálogo, sin nada precargado. Ya se sabe (unitPriceModes,
// calculado al confirmar Daniel) cuántas unidades de cada producto van a
// costo y cuántas a Dropi. Cuotas libres, sin tope, decide ella. Pedido
// explícito del usuario: el admin ve esta misma cola pero sin poder tocar
// nada — ni precio, ni rechazo, ni cuotas.
export function PersonalPurchasesFinancePanel({ isAdmin = false }: { isAdmin?: boolean }) {
  const [orders, setOrders] = useState<Order[] | null>(null);
  const [prices, setPrices] = useState<Record<string, { cost: string; dropi: string }>>({});
  const [installments, setInstallments] = useState<Record<string, string>>({});
  const [rejecting, setRejecting] = useState<string | null>(null);
  const [rejectReason, setRejectReason] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<Record<string, string>>({});
  const [zoomedPhoto, setZoomedPhoto] = useState<string | null>(null);

  function load() {
    fetch("/api/personal-purchases/pending-finance").then((r) => (r.ok ? r.json() : [])).then(setOrders);
  }
  useEffect(load, []);

  function priceFor(itemId: string) {
    return prices[itemId] ?? { cost: "", dropi: "" };
  }

  async function confirm(order: Order) {
    const items = order.items.map((it) => {
      const p = priceFor(it.id);
      return { itemId: it.id, costUnitPrice: Number(p.cost || 0), dropiUnitPrice: Number(p.dropi || 0) };
    });
    const installmentsN = Number(installments[order.id] || 1);
    setBusy(true);
    setErr((e) => ({ ...e, [order.id]: "" }));
    const res = await fetch(`/api/personal-purchases/${order.id}/confirm-finance`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ items, installments: installmentsN }),
    });
    setBusy(false);
    const data = await res.json().catch(() => null);
    if (!res.ok) { setErr((e) => ({ ...e, [order.id]: data?.error ?? "No se pudo confirmar." })); return; }
    load();
  }

  async function reject(id: string) {
    if (!rejectReason.trim()) return;
    setBusy(true);
    await fetch(`/api/personal-purchases/${id}/reject`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ reason: rejectReason.trim() }),
    });
    setBusy(false);
    setRejecting(null);
    setRejectReason("");
    load();
  }

  if (!orders) return <div className="text-steel text-[13px]">Cargando…</div>;

  return (
    <div>
      <div className="text-[11px] font-semibold uppercase tracking-wide text-steel mb-3">Compras personales — cerrar precio ({orders.length})</div>
      {orders.length === 0 && <div className="border-[1.5px] border-dashed border-rule rounded-md p-6 text-center text-steel text-[13px]">Nada pendiente por ahora.</div>}
      <div className="flex flex-col gap-3">
        {orders.map((o) => {
          let orderTotal = 0;
          const allPriced = o.items.every((it) => {
            const p = priceFor(it.id);
            return Number(p.cost) > 0 || Number(p.dropi) > 0 || (it.unitPriceModes ?? []).length === 0;
          });
          return (
            <div key={o.id} className="bg-surface border border-rule rounded-md p-3.5">
              <div className="font-bold text-[13px] mb-2.5">{o.employee.name}</div>
              <div className="flex flex-col gap-3">
                {o.items.map((it) => {
                  const modes = it.unitPriceModes ?? [];
                  const costCount = modes.filter((m) => m === "COST").length;
                  const dropiCount = modes.filter((m) => m === "DROPI").length;
                  const p = priceFor(it.id);
                  const itemTotal = costCount * Number(p.cost || 0) + dropiCount * Number(p.dropi || 0);
                  orderTotal += itemTotal;
                  return (
                    <div key={it.id} className="border-b border-rule last:border-0 pb-3 last:pb-0">
                      <div className="flex gap-2.5 mb-1.5">
                        {/* eslint-disable-next-line @next/next/no-img-element */}
                        <img
                          src={it.livePhotoUrl}
                          alt="Foto del producto"
                          className="w-16 h-16 object-cover rounded-md border border-rule shrink-0 cursor-zoom-in"
                          onDoubleClick={() => setZoomedPhoto(it.livePhotoUrl)}
                          onClick={() => setZoomedPhoto(it.livePhotoUrl)}
                        />
                        {it.optionalPhotoUrl && (
                          // eslint-disable-next-line @next/next/no-img-element
                          <img
                            src={it.optionalPhotoUrl}
                            alt="Foto extra"
                            className="w-16 h-16 object-cover rounded-md border border-rule shrink-0 cursor-zoom-in"
                            onDoubleClick={() => setZoomedPhoto(it.optionalPhotoUrl)}
                            onClick={() => setZoomedPhoto(it.optionalPhotoUrl)}
                          />
                        )}
                      </div>
                      <div className="text-[12.5px] font-semibold">{it.confirmedProductName ?? it.employeeProductName} × {it.quantity}</div>
                      <div className="text-[10.5px] text-steel-dim mb-1.5">
                        {costCount > 0 && `${costCount} al costo`}{costCount > 0 && dropiCount > 0 && " · "}{dropiCount > 0 && `${dropiCount} Dropi`}
                      </div>
                      {!isAdmin && (
                        <div className="flex items-center gap-2 flex-wrap">
                          {costCount > 0 && (
                            <div className="flex items-center gap-1.5">
                              <label className="text-[11px] text-steel">Precio al costo (c/u)</label>
                              <input className="text-[12px] rounded border border-rule bg-cloud px-2 py-1 w-20" type="number" step="0.01" placeholder="$0.00"
                                value={p.cost} onChange={(e) => setPrices((s) => ({ ...s, [it.id]: { ...priceFor(it.id), cost: e.target.value } }))} />
                            </div>
                          )}
                          {dropiCount > 0 && (
                            <div className="flex items-center gap-1.5">
                              <label className="text-[11px] text-steel">Precio Dropi (c/u)</label>
                              <input className="text-[12px] rounded border border-rule bg-cloud px-2 py-1 w-20" type="number" step="0.01" placeholder="$0.00"
                                value={p.dropi} onChange={(e) => setPrices((s) => ({ ...s, [it.id]: { ...priceFor(it.id), dropi: e.target.value } }))} />
                            </div>
                          )}
                          {itemTotal > 0 && <span className="text-[12px] font-bold">= {money(itemTotal)}</span>}
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>

              {isAdmin ? (
                <div className="text-[11.5px] text-steel-dim italic mt-2">Nairoby define el precio.</div>
              ) : (
                <>
                  <div className="flex items-center gap-2 mt-3 flex-wrap">
                    {orderTotal > 0 && <span className="text-[13px] font-bold">Total: {money(orderTotal)}</span>}
                    <label className="text-[11px] text-steel ml-2">Cuotas</label>
                    <input className="text-[12px] rounded border border-rule bg-cloud px-2 py-1 w-16" type="number" min={1}
                      value={installments[o.id] ?? "1"} onChange={(e) => setInstallments((s) => ({ ...s, [o.id]: e.target.value }))} />
                  </div>
                  {err[o.id] && <div className="text-red text-[11.5px] mt-1.5">{err[o.id]}</div>}

                  {rejecting === o.id ? (
                    <div className="mt-3 pt-3 border-t border-rule">
                      <input className="text-[12px] rounded border border-rule bg-cloud px-2 py-1.5 w-full mb-2" placeholder="Motivo del rechazo" value={rejectReason} onChange={(e) => setRejectReason(e.target.value)} />
                      <div className="flex gap-2">
                        <button type="button" disabled={busy || !rejectReason.trim()} className="text-[12px] font-bold bg-red text-white rounded px-3 py-1.5 cursor-pointer disabled:opacity-50" onClick={() => reject(o.id)}>Confirmar rechazo</button>
                        <button type="button" className="text-[12px] text-steel cursor-pointer" onClick={() => { setRejecting(null); setRejectReason(""); }}>Cancelar</button>
                      </div>
                    </div>
                  ) : (
                    <div className="flex gap-2 mt-2.5">
                      <button type="button" disabled={busy || !allPriced || orderTotal <= 0} className="text-[12px] font-bold bg-green text-white rounded-md px-3.5 py-1.5 cursor-pointer disabled:opacity-40" onClick={() => confirm(o)}>Confirmar precio</button>
                      <button type="button" disabled={busy} className="text-[12px] font-semibold text-red cursor-pointer" onClick={() => setRejecting(o.id)}>Rechazar</button>
                    </div>
                  )}
                </>
              )}
            </div>
          );
        })}
      </div>
      {zoomedPhoto && (
        <div
          className="fixed inset-0 z-50 bg-black/80 flex items-center justify-center p-6 cursor-zoom-out"
          onClick={() => setZoomedPhoto(null)}
        >
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={zoomedPhoto} alt="Foto ampliada" className="max-w-full max-h-full object-contain rounded-md" />
        </div>
      )}
    </div>
  );
}
