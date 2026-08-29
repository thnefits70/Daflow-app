"use client";

import { useEffect, useState } from "react";
import { ProductMatchPicker, type MatchCatalogItem, type ProductMatchResult } from "@/components/merchandise-reentry/ProductMatchPicker";
import { CatalogCode } from "@/components/shared/CatalogCode";

type Item = {
  id: string;
  employeeProductName: string;
  catalogItem: MatchCatalogItem | null;
  livePhotoUrl: string;
  optionalPhotoUrl: string | null;
  quantity: number;
  unitDeclarations: { relation: string; note?: string }[];
};
type Order = {
  id: string;
  employee: { id: string; name: string };
  items: Item[];
  createdAt: string;
};

const RELATION_LABEL: Record<string, string> = { SELF: "él/ella mismo/a", MINOR_CHILD: "hijo/a menor", OTHER_FAMILY: "otra persona" };

function formatDateTime(iso: string) {
  return new Date(iso).toLocaleString("es-EC", { day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit" });
}

function formatGapMinutes(diffMin: number) {
  if (diffMin < 1) return "menos de 1 min";
  if (diffMin < 60) return `${Math.round(diffMin)} min`;
  const diffH = diffMin / 60;
  if (diffH < 24) return `${Math.round(diffH)} h`;
  return `${Math.round(diffH / 24)} d`;
}

// Detecta posibles duplicados: mismo empleado + mismo texto de producto en
// otra orden pendiente. No bloquea nada, solo avisa — Daniel decide si es
// error humano (clon) o dos compras reales según qué tan cerca estén los
// horarios.
function findDuplicateGap(order: Order, item: Item, orders: Order[]): string | null {
  const norm = item.employeeProductName.trim().toLowerCase();
  let closestGapMin: number | null = null;
  for (const o of orders) {
    if (o.id === order.id || o.employee.id !== order.employee.id) continue;
    for (const it of o.items) {
      if (it.employeeProductName.trim().toLowerCase() !== norm) continue;
      const gapMin = Math.abs(new Date(order.createdAt).getTime() - new Date(o.createdAt).getTime()) / 60000;
      if (closestGapMin === null || gapMin < closestGapMin) closestGapMin = gapMin;
    }
  }
  return closestGapMin === null ? null : formatGapMinutes(closestGapMin);
}

// Confirmado 2026-08-20: pantalla de Daniel — confirmar acá es un solo
// paso que hace dos cosas a la vez: corrige/normaliza el nombre de cada
// producto según el sistema JUST (lo que escribió el colaborador es solo
// una referencia de memoria, y ese nombre corregido es el que se usa
// después para el enfriamiento de 6 meses) Y habilita el retiro físico —
// el colaborador recibe el aviso de "ya podés retirarlo" en el mismo
// momento. Ya no hay un segundo paso manual de "aprobar salida".
export function PersonalPurchasesInventoryPanel() {
  const [orders, setOrders] = useState<Order[] | null>(null);
  const [confirmed, setConfirmed] = useState<Record<string, MatchCatalogItem | null>>({});
  const [rejecting, setRejecting] = useState<string | null>(null);
  const [rejectReason, setRejectReason] = useState("");
  const [busy, setBusy] = useState(false);
  const [zoomedPhoto, setZoomedPhoto] = useState<string | null>(null);

  function load() {
    fetch("/api/personal-purchases/pending-inventory").then((r) => (r.ok ? r.json() : [])).then((rows: Order[]) => {
      setOrders(rows);
      setConfirmed((prev) => {
        const next = { ...prev };
        for (const o of rows) for (const it of o.items) if (next[it.id] === undefined) next[it.id] = it.catalogItem;
        return next;
      });
    });
  }
  useEffect(load, []);

  async function confirm(order: Order) {
    setBusy(true);
    await fetch(`/api/personal-purchases/${order.id}/confirm-inventory`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ items: order.items.map((it) => ({ itemId: it.id, confirmedCatalogItemId: confirmed[it.id]!.id })) }),
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
          const allNamed = o.items.every((it) => !!confirmed[it.id]);
          return (
            <div key={o.id} className="bg-surface border border-rule rounded-md p-3.5">
              <div className="flex items-baseline justify-between mb-2.5">
                <div className="font-bold text-[13px]">{o.employee.name}</div>
                <div className="text-[10.5px] text-steel-dim">{formatDateTime(o.createdAt)}</div>
              </div>
              <div className="flex flex-col gap-3">
                {o.items.map((it) => {
                  const dupGap = findDuplicateGap(o, it, orders);
                  return (
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
                      {dupGap && (
                        <div className="text-[10.5px] font-semibold text-gold mb-1.5">⚠️ Posible duplicado — {o.employee.name} tiene otra solicitud igual hace {dupGap}</div>
                      )}
                      {confirmed[it.id] ? (
                        <div className="flex items-center gap-2 bg-green/10 border border-green/35 rounded-md px-2 py-1.5 mb-1.5">
                          <div className="flex-1 min-w-0 text-[12.5px] font-semibold flex items-center gap-1.5">
                            <CatalogCode code={confirmed[it.id]!.justCode} />
                            <span className="truncate">{confirmed[it.id]!.name}</span>
                          </div>
                          <button type="button" className="shrink-0 text-[11px] font-semibold text-blue cursor-pointer" onClick={() => setConfirmed((n) => ({ ...n, [it.id]: null }))}>
                            Cambiar
                          </button>
                        </div>
                      ) : (
                        <div className="mb-1.5">
                          <ProductMatchPicker
                            referencePhotoUrl={it.livePhotoUrl}
                            initialQuery={it.employeeProductName}
                            searchUrl="/api/personal-purchases/catalog-search"
                            onConfirm={(r: ProductMatchResult) => setConfirmed((n) => ({ ...n, [it.id]: r }))}
                          />
                        </div>
                      )}
                      <div className="text-[10.5px] text-steel-dim">
                        {it.unitDeclarations.map((d, i) => `Unidad ${i + 1}: ${RELATION_LABEL[d.relation]}${d.note ? ` (${d.note})` : ""}`).join(" · ")}
                      </div>
                    </div>
                  </div>
                  );
                })}
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
