"use client";

import { useState } from "react";
import { formatDateTime } from "@/lib/formatDateTime";
import { CatalogCode } from "@/components/shared/CatalogCode";

type Item = {
  id: string;
  confirmedProductName: string | null;
  employeeProductName: string;
  quantity: number;
  costUnitPrice: number | null;
  dropiUnitPrice: number | null;
  itemTotal: number | null;
  confirmedCatalogItem: { justCode: string | null } | null;
};
type Order = {
  id: string;
  status: string;
  employee: { name: string };
  items: Item[];
  totalAmount: number | null;
  installments: number;
  paymentMethod: "PAYROLL" | "TRANSFER" | null;
  rejectionReason: string | null;
  createdAt: string;
};

function money(n: number | null) {
  return n == null ? "—" : `$${n.toFixed(2)}`;
}

const STATUS_LABEL: Record<string, string> = {
  PENDING_PAYMENT_METHOD: "Precio cerrado — falta que elija cómo paga",
  PENDING_TRANSFER_PROOF: "Eligió transferencia — falta comprobante",
  PENDING_ADMIN_CONFIRM: "Comprobante subido — falta confirmar admin",
  PENDING_NAIROBY_CLOSE: "Transferencia confirmada — falta cerrar",
  APPROVED: "Aprobado",
  REJECTED: "Rechazado",
};
const STATUS_COLOR: Record<string, string> = {
  APPROVED: "#22C55E",
  REJECTED: "#EF4444",
};

// Solo para ver — historial de compras personales ya resueltas (precio
// cerrado en adelante). Sin ninguna acción, ni admin ni Nairoby pueden
// tocar nada acá.
export function PersonalPurchasesHistoryPanel() {
  const [open, setOpen] = useState(false);
  const [orders, setOrders] = useState<Order[] | null>(null);

  function toggle() {
    if (!open && orders === null) {
      fetch("/api/personal-purchases/history").then((r) => (r.ok ? r.json() : [])).then(setOrders);
    }
    setOpen((v) => !v);
  }

  return (
    <div>
      <button
        type="button"
        className="text-[11px] font-semibold uppercase tracking-wide text-steel mb-3 cursor-pointer flex items-center gap-1.5"
        onClick={toggle}
      >
        <span className={`inline-block transition-transform ${open ? "rotate-90" : ""}`}>›</span>
        Historial de compras personales
      </button>

      {open && (
        orders === null ? (
          <div className="text-steel text-[13px]">Cargando…</div>
        ) : orders.length === 0 ? (
          <div className="border-[1.5px] border-dashed border-rule rounded-md p-6 text-center text-steel text-[13px]">Todavía no hay historial.</div>
        ) : (
          <div className="flex flex-col gap-3">
            {orders.map((o) => (
              <div key={o.id} className="bg-surface border border-rule rounded-md p-3.5">
                <div className="flex items-center justify-between gap-3 mb-1">
                  <div className="font-bold text-[13px]">{o.employee.name}</div>
                  <div className="font-bold text-[13px] tabular-nums">{money(o.totalAmount)}</div>
                </div>
                <div className="flex items-center gap-2 flex-wrap mb-2">
                  <span className="text-[11px] text-steel-dim">{formatDateTime(o.createdAt)}</span>
                  <span
                    className="text-[10.5px] font-semibold rounded-full px-2 py-0.5"
                    style={{ color: STATUS_COLOR[o.status] ?? "#D9A441", border: `1px solid ${STATUS_COLOR[o.status] ?? "#D9A441"}` }}
                  >
                    {STATUS_LABEL[o.status] ?? o.status}
                  </span>
                  {o.paymentMethod && (
                    <span className="text-[11px] text-steel-dim">{o.paymentMethod === "PAYROLL" ? "Descuento en rol" : "Transferencia"}</span>
                  )}
                  {o.installments > 1 && <span className="text-[11px] text-steel-dim">{o.installments} cuotas</span>}
                </div>

                <div className="flex flex-col gap-1">
                  {o.items.map((it) => (
                    <div key={it.id} className="flex items-center justify-between text-[12px]">
                      <span className="flex items-center gap-1.5">
                        <CatalogCode code={it.confirmedCatalogItem?.justCode} />
                        <span>{it.confirmedProductName ?? it.employeeProductName} × {it.quantity}</span>
                      </span>
                      <span className="text-steel-dim tabular-nums">
                        {it.costUnitPrice ? `${money(it.costUnitPrice)} costo` : ""}
                        {it.costUnitPrice && it.dropiUnitPrice ? " · " : ""}
                        {it.dropiUnitPrice ? `${money(it.dropiUnitPrice)} Dropi` : ""}
                        {it.itemTotal != null && ` = ${money(it.itemTotal)}`}
                      </span>
                    </div>
                  ))}
                </div>

                {o.status === "REJECTED" && o.rejectionReason && (
                  <div className="text-[11.5px] text-red mt-2">Motivo: {o.rejectionReason}</div>
                )}
              </div>
            ))}
          </div>
        )
      )}
    </div>
  );
}
