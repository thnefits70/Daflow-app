"use client";

import { useEffect, useState } from "react";
import { CatalogCode } from "@/components/shared/CatalogCode";

type Item = {
  id: string;
  confirmedProductName: string | null;
  employeeProductName: string;
  quantity: number;
  unitPriceModes: string[] | null;
  livePhotoUrl: string;
  optionalPhotoUrl: string | null;
  costUnitPrice: number | null;
  dropiUnitPrice: number | null;
  confirmedCatalogItem: { justCode: string | null } | null;
};
type Order = {
  id: string;
  employee: { name: string };
  items: Item[];
};

type AwaitingCostItem = { confirmedProductName: string | null; employeeProductName: string; quantity: number; confirmedCatalogItem: { justCode: string | null } | null };
type AwaitingCostOrder = { id: string; employee: { name: string }; items: AwaitingCostItem[] };

function money(n: number) {
  return `$${n.toFixed(2)}`;
}

// Confirmado 2026-09-21, pedido explícito del usuario: el precio ya NO se
// digita acá en el primer cierre — se calcula solo con el costo de
// INVESTOCK apenas Daniel confirma bodega (ver attemptAutoPriceOrder en
// personalPurchases.ts). Esta pantalla (para Nairoby) ahora solo muestra
// pedidos que ELLA MISMA reabrió para corregir un precio ya cerrado
// (priceReopenedAt no nulo) — ahí sí sigue digitando el monto a mano, sin
// catálogo, igual que antes. El admin ve esta misma cola sin poder tocar
// nada — ni precio, ni rechazo — más una sección aparte (arriba) exclusiva
// de admin con los pedidos que se quedaron esperando costo de INVESTOCK.
// Confirmado 2026-09-08 (pedido explícito del usuario): las cuotas ya NO
// se deciden acá — las elige el colaborador recién al escoger "Descuento
// en rol" (con tope según el total).
export function PersonalPurchasesFinancePanel({ isAdmin = false }: { isAdmin?: boolean }) {
  const [orders, setOrders] = useState<Order[] | null>(null);
  const [prices, setPrices] = useState<Record<string, { cost: string; dropi: string }>>({});
  const [rejecting, setRejecting] = useState<string | null>(null);
  const [rejectReason, setRejectReason] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<Record<string, string>>({});
  const [zoomedPhoto, setZoomedPhoto] = useState<string | null>(null);
  const [awaitingCost, setAwaitingCost] = useState<AwaitingCostOrder[] | null>(null);
  const [awaitingCostErr, setAwaitingCostErr] = useState<Record<string, string>>({});

  function load() {
    fetch("/api/personal-purchases/pending-finance")
      .then((r) => (r.ok ? r.json() : []))
      .then((data: Order[]) => {
        setOrders(data);
        // Precarga lo que ya estaba puesto (ej. una orden reabierta para
        // corregir el precio) sin pisar lo que el usuario ya esté tipeando.
        setPrices((prev) => {
          const next = { ...prev };
          for (const o of data) {
            for (const it of o.items) {
              if (next[it.id] || (it.costUnitPrice == null && it.dropiUnitPrice == null)) continue;
              next[it.id] = { cost: it.costUnitPrice != null ? String(it.costUnitPrice) : "", dropi: it.dropiUnitPrice != null ? String(it.dropiUnitPrice) : "" };
            }
          }
          return next;
        });
      });
    if (isAdmin) {
      fetch("/api/personal-purchases/awaiting-cost")
        .then((r) => (r.ok ? r.json() : []))
        .then(setAwaitingCost);
    }
  }
  useEffect(load, []);

  async function retryAutoPrice(id: string) {
    setBusy(true);
    setAwaitingCostErr((e) => ({ ...e, [id]: "" }));
    const res = await fetch(`/api/personal-purchases/${id}/retry-auto-price`, { method: "POST" });
    setBusy(false);
    const data = await res.json().catch(() => null);
    if (!res.ok) { setAwaitingCostErr((e) => ({ ...e, [id]: data?.error ?? "No se pudo reintentar." })); return; }
    load();
  }

  function priceFor(itemId: string) {
    return prices[itemId] ?? { cost: "", dropi: "" };
  }

  async function confirm(order: Order) {
    const items = order.items.map((it) => {
      const p = priceFor(it.id);
      return { itemId: it.id, costUnitPrice: Number(p.cost || 0), dropiUnitPrice: Number(p.dropi || 0) };
    });
    setBusy(true);
    setErr((e) => ({ ...e, [order.id]: "" }));
    const res = await fetch(`/api/personal-purchases/${order.id}/confirm-finance`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ items }),
    });
    setBusy(false);
    const data = await res.json().catch(() => null);
    if (!res.ok) { setErr((e) => ({ ...e, [order.id]: data?.error ?? "No se pudo confirmar." })); return; }
    load();
  }

  async function recalculate(id: string) {
    setBusy(true);
    setErr((e) => ({ ...e, [id]: "" }));
    const res = await fetch(`/api/personal-purchases/${id}/recalculate-price-modes`, { method: "POST" });
    setBusy(false);
    const data = await res.json().catch(() => null);
    if (!res.ok) { setErr((e) => ({ ...e, [id]: data?.error ?? "No se pudo recalcular." })); return; }
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
      {isAdmin && awaitingCost && awaitingCost.length > 0 && (
        <div className="mb-5">
          <div className="text-[11px] font-semibold uppercase tracking-wide text-steel mb-2">Esperando costo en INVESTOCK ({awaitingCost.length})</div>
          <div className="text-[11.5px] text-steel-dim mb-2.5">Bodega ya confirmó estos pedidos, pero algún producto todavía no tiene costo cargado — nadie puede escribir un precio a mano acá. Reintentá una vez esté cargado en INVESTOCK.</div>
          <div className="flex flex-col gap-2">
            {awaitingCost.map((o) => (
              <div key={o.id} className="bg-surface border border-rule rounded-md p-3">
                <div className="font-bold text-[12.5px] mb-1">{o.employee.name}</div>
                <div className="text-[11.5px] text-steel-dim mb-2">
                  {o.items.map((it, i) => (
                    <span key={i}>
                      {i > 0 && ", "}
                      {it.confirmedProductName ?? it.employeeProductName} × {it.quantity}
                    </span>
                  ))}
                </div>
                <button type="button" disabled={busy} className="text-[11.5px] font-semibold text-blue cursor-pointer" onClick={() => retryAutoPrice(o.id)}>
                  Reintentar precio automático
                </button>
                {awaitingCostErr[o.id] && <div className="text-red text-[11px] mt-1">{awaitingCostErr[o.id]}</div>}
              </div>
            ))}
          </div>
        </div>
      )}
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
                      <div className="text-[12.5px] font-semibold flex items-center gap-1.5">
                        <CatalogCode code={it.confirmedCatalogItem?.justCode} />
                        <span>{it.confirmedProductName ?? it.employeeProductName} × {it.quantity}</span>
                      </div>
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
                  <div className="mt-2">
                    <button type="button" disabled={busy} className="text-[11px] font-semibold text-blue cursor-pointer" onClick={() => recalculate(o.id)}>
                      Recalcular quién va a costo/Dropi (reglas actuales)
                    </button>
                  </div>
                  <div className="flex items-center gap-2 mt-3 flex-wrap">
                    {orderTotal > 0 && <span className="text-[13px] font-bold">Total: {money(orderTotal)}</span>}
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
