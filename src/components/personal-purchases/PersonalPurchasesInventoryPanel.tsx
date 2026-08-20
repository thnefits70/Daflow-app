"use client";

import { useEffect, useState } from "react";

type Item = {
  id: string;
  employeeProductName: string;
  livePhotoUrl: string;
  optionalPhotoUrl: string | null;
  quantity: number;
  unitDeclarations: { relation: string; note?: string }[];
};
type Order = {
  id: string;
  employee: { name: string };
  items: Item[];
};
type PickupOrder = {
  id: string;
  employee: { name: string };
  items: { employeeProductName: string; confirmedProductName: string | null; quantity: number }[];
};

const RELATION_LABEL: Record<string, string> = { SELF: "él/ella mismo/a", MINOR_CHILD: "hijo/a menor", OTHER_FAMILY: "otra persona" };

// Confirmado 2026-08-18: pantalla de Daniel — confirmar acá es lo que
// habilita el retiro físico de bodega. Por cada producto corrige/normaliza
// el nombre según el sistema JUST (lo que escribió el colaborador es solo
// una referencia de memoria) — ese nombre corregido es el que se usa
// después para el enfriamiento de 6 meses.
export function PersonalPurchasesInventoryPanel() {
  const [orders, setOrders] = useState<Order[] | null>(null);
  const [names, setNames] = useState<Record<string, string>>({});
  const [rejecting, setRejecting] = useState<string | null>(null);
  const [rejectReason, setRejectReason] = useState("");
  const [busy, setBusy] = useState(false);
  const [zoomedPhoto, setZoomedPhoto] = useState<string | null>(null);
  const [pickupOrders, setPickupOrders] = useState<PickupOrder[] | null>(null);
  const [pickupBusy, setPickupBusy] = useState(false);

  function load() {
    fetch("/api/personal-purchases/pending-inventory").then((r) => (r.ok ? r.json() : [])).then((rows: Order[]) => {
      setOrders(rows);
      setNames((prev) => {
        const next = { ...prev };
        for (const o of rows) for (const it of o.items) if (next[it.id] === undefined) next[it.id] = it.employeeProductName;
        return next;
      });
    });
  }
  useEffect(load, []);

  function loadPickup() {
    fetch("/api/personal-purchases/pending-pickup").then((r) => (r.ok ? r.json() : [])).then(setPickupOrders);
  }
  useEffect(loadPickup, []);

  async function approvePickup(id: string) {
    setPickupBusy(true);
    await fetch(`/api/personal-purchases/${id}/mark-picked-up`, { method: "POST" });
    setPickupBusy(false);
    loadPickup();
  }

  async function confirm(order: Order) {
    setBusy(true);
    await fetch(`/api/personal-purchases/${order.id}/confirm-inventory`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ items: order.items.map((it) => ({ itemId: it.id, confirmedProductName: (names[it.id] ?? it.employeeProductName).trim() })) }),
    });
    setBusy(false);
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
      <div className="text-[11px] font-semibold uppercase tracking-wide text-steel mb-3">Compras personales pendientes ({orders.length})</div>
      {orders.length === 0 && <div className="border-[1.5px] border-dashed border-rule rounded-md p-6 text-center text-steel text-[13px]">Nada pendiente por ahora.</div>}
      <div className="flex flex-col gap-3">
        {orders.map((o) => {
          const allNamed = o.items.every((it) => (names[it.id] ?? "").trim().length > 0);
          return (
            <div key={o.id} className="bg-surface border border-rule rounded-md p-3.5">
              <div className="font-bold text-[13px] mb-2.5">{o.employee.name}</div>
              <div className="flex flex-col gap-3">
                {o.items.map((it) => (
                  <div key={it.id} className="flex gap-3 items-start border-b border-rule last:border-0 pb-3 last:pb-0">
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img
                      src={it.livePhotoUrl}
                      alt="Foto del producto"
                      className="w-16 h-16 object-cover rounded-md border border-rule shrink-0 cursor-zoom-in"
                      onDoubleClick={() => setZoomedPhoto(it.livePhotoUrl)}
                    />
                    {it.optionalPhotoUrl && (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img
                        src={it.optionalPhotoUrl}
                        alt="Foto extra"
                        className="w-16 h-16 object-cover rounded-md border border-rule shrink-0 cursor-zoom-in"
                        onDoubleClick={() => setZoomedPhoto(it.optionalPhotoUrl)}
                      />
                    )}
                    <div className="flex-1 min-w-0">
                      <div className="text-[11px] text-steel-dim mb-1">Escribió: &quot;{it.employeeProductName}&quot; × {it.quantity}</div>
                      <input
                        className="rounded border border-rule bg-cloud px-2 py-1 text-[12.5px] w-full mb-1.5"
                        placeholder="Nombre según JUST"
                        value={names[it.id] ?? ""}
                        onChange={(e) => setNames((n) => ({ ...n, [it.id]: e.target.value }))}
                      />
                      <div className="text-[10.5px] text-steel-dim">
                        {it.unitDeclarations.map((d, i) => `Unidad ${i + 1}: ${RELATION_LABEL[d.relation]}${d.note ? ` (${d.note})` : ""}`).join(" · ")}
                      </div>
                    </div>
                  </div>
                ))}
              </div>
              {rejecting === o.id ? (
                <div className="mt-3 pt-3 border-t border-rule">
                  <input className="text-[12px] rounded border border-rule bg-cloud px-2 py-1.5 w-full mb-2" placeholder="Motivo del rechazo" value={rejectReason} onChange={(e) => setRejectReason(e.target.value)} />
                  <div className="flex gap-2">
                    <button type="button" disabled={busy || !rejectReason.trim()} className="text-[12px] font-bold bg-red text-white rounded px-3 py-1.5 cursor-pointer disabled:opacity-50" onClick={() => reject(o.id)}>Confirmar rechazo</button>
                    <button type="button" className="text-[12px] text-steel cursor-pointer" onClick={() => { setRejecting(null); setRejectReason(""); }}>Cancelar</button>
                  </div>
                </div>
              ) : (
                <div className="flex gap-2 mt-3">
                  <button type="button" disabled={busy || !allNamed} className="text-[12px] font-bold bg-green text-white rounded-md px-3.5 py-1.5 cursor-pointer disabled:opacity-50" onClick={() => confirm(o)}>Confirmar producto</button>
                  <button type="button" disabled={busy} className="text-[12px] font-semibold text-red cursor-pointer" onClick={() => setRejecting(o.id)}>Rechazar</button>
                </div>
              )}
            </div>
          );
        })}
      </div>

      <div className="mt-6 pt-5 border-t border-rule">
        <div className="text-[11px] font-semibold uppercase tracking-wide text-steel mb-3">Listas para retirar ({pickupOrders?.length ?? 0})</div>
        {(pickupOrders?.length ?? 0) === 0 ? (
          <div className="border-[1.5px] border-dashed border-rule rounded-md p-6 text-center text-steel text-[13px]">Nada esperando salida por ahora.</div>
        ) : (
          <div className="flex flex-col gap-2.5">
            {pickupOrders!.map((o) => (
              <div key={o.id} className="flex items-center gap-3 bg-surface border border-rule rounded-md p-3">
                <div className="flex-1 min-w-0">
                  <div className="font-bold text-[12.5px]">{o.employee.name}</div>
                  <div className="text-[11px] text-steel-dim">
                    {o.items.map((it) => `${it.confirmedProductName ?? it.employeeProductName} × ${it.quantity}`).join(", ")}
                  </div>
                </div>
                <button type="button" disabled={pickupBusy} className="text-[12px] font-bold bg-green text-white rounded-md px-3.5 py-1.5 cursor-pointer disabled:opacity-50 shrink-0" onClick={() => approvePickup(o.id)}>
                  Aprobar salida
                </button>
              </div>
            ))}
          </div>
        )}
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
