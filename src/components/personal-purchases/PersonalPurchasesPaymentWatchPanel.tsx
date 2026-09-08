"use client";

import { useEffect, useState } from "react";
import { formatDateTime } from "@/lib/formatDateTime";

type Order = {
  id: string;
  status: "PENDING_PAYMENT_METHOD" | "PENDING_TRANSFER_PROOF";
  totalAmount: number | null;
  transferDeadlineAt: string | null;
  financeConfirmedAt: string | null;
  employee: { name: string };
};

function money(n: number | null) {
  return n == null ? "—" : `$${n.toFixed(2)}`;
}

const STATUS_LABEL: Record<Order["status"], string> = {
  PENDING_PAYMENT_METHOD: "Precio cerrado — falta que elija cómo paga",
  PENDING_TRANSFER_PROOF: "Eligió transferencia — falta comprobante",
};

// A esto debe llevar la notificación "Compras personales — esperando que el
// colaborador resuelva el pago" (getPersonalPurchasePaymentWatchItem en
// pendingTasks.ts). Antes de este panel esa notificación aterrizaba en esta
// pestaña sin nada que mostrara justo estos dos estados, y se veía vacía.
// El pago en sí lo resuelve el colaborador, no Nairoby/admin — la única
// acción posible acá es "Corregir precio" (2026-09-08, pedido explícito del
// usuario tras un caso real donde se confirmó un precio equivocado): exclusivo
// de Nairoby (no admin, mismo criterio que fijar el precio), regresa la orden
// a "cerrar precio" para que lo arregle y vuelva a confirmar.
export function PersonalPurchasesPaymentWatchPanel({ canReopenPrice = false }: { canReopenPrice?: boolean }) {
  const [orders, setOrders] = useState<Order[] | null>(null);
  const [reopening, setReopening] = useState<string | null>(null);
  const [err, setErr] = useState<Record<string, string>>({});

  function load() {
    fetch("/api/personal-purchases/pending-payment").then((r) => (r.ok ? r.json() : [])).then(setOrders);
  }
  useEffect(load, []);

  async function reopenPrice(id: string) {
    setReopening(id);
    setErr((e) => ({ ...e, [id]: "" }));
    const res = await fetch(`/api/personal-purchases/${id}/reopen-price`, { method: "POST" });
    const data = await res.json().catch(() => null);
    setReopening(null);
    if (!res.ok) { setErr((e) => ({ ...e, [id]: data?.error ?? "No se pudo reabrir." })); return; }
    load();
  }

  if (!orders) return <div className="text-steel text-[13px]">Cargando…</div>;

  return (
    <div>
      <div className="text-[11px] font-semibold uppercase tracking-wide text-steel mb-3">
        Compras personales — esperando pago del colaborador ({orders.length})
      </div>
      {orders.length === 0 ? (
        <div className="border-[1.5px] border-dashed border-rule rounded-md p-6 text-center text-steel text-[13px]">
          Nadie tiene un pago pendiente en este momento.
        </div>
      ) : (
        <div className="flex flex-col gap-3">
          {orders.map((o) => {
            const overdue = o.transferDeadlineAt != null && new Date(o.transferDeadlineAt) <= new Date();
            return (
              <div key={o.id} className="bg-surface border border-rule rounded-md p-3.5">
                <div className="flex items-center justify-between gap-3 mb-1">
                  <div className="font-bold text-[13px]">{o.employee.name}</div>
                  <div className="font-bold text-[13px] tabular-nums">{money(o.totalAmount)}</div>
                </div>
                <div className="flex items-center gap-2 flex-wrap">
                  <span
                    className="text-[10.5px] font-semibold rounded-full px-2 py-0.5"
                    style={{ color: overdue ? "#EF4444" : "#D9A441", border: `1px solid ${overdue ? "#EF4444" : "#D9A441"}` }}
                  >
                    {STATUS_LABEL[o.status]}{overdue ? " · atrasado" : ""}
                  </span>
                  {o.financeConfirmedAt && (
                    <span className="text-[11px] text-steel-dim">Precio cerrado el {formatDateTime(o.financeConfirmedAt)}</span>
                  )}
                </div>
                {canReopenPrice && (
                  <div className="mt-2 pt-2 border-t border-rule">
                    <button
                      type="button"
                      disabled={reopening === o.id}
                      className="text-[11.5px] font-semibold cursor-pointer disabled:opacity-50"
                      style={{ color: "#D9A441" }}
                      onClick={() => reopenPrice(o.id)}
                    >
                      {reopening === o.id ? "Reabriendo…" : "Corregir precio"}
                    </button>
                    {err[o.id] && <div className="text-red text-[11px] mt-1">{err[o.id]}</div>}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
