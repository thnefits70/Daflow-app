"use client";

import { useEffect, useState } from "react";
import { addMonthsToMonthStr, installmentAmount, installmentIndexForMonth } from "@/lib/payrollCalc";

type Order = {
  id: string;
  status: string;
  totalAmount: number | null;
  installments: number;
  paymentMethod: "PAYROLL" | "TRANSFER" | null;
  firstPayoutMonth: string | null;
  financeConfirmedAt: string | null;
  transferClosedAt: string | null;
  employee: { name: string };
  items: { confirmedProductName: string | null; employeeProductName: string; quantity: number }[];
};

type Row = {
  key: string;
  employee: string;
  product: string;
  amount: number;
  detail: string;
  state: "cobrada" | "este-mes" | "pendiente";
};

const NO_MONTH_BUCKET = "sin-mes";

const UNRESOLVED_LABEL: Record<string, string> = {
  PENDING_PAYMENT_METHOD: "Falta que elija cómo paga",
  PENDING_TRANSFER_PROOF: "Eligió transferencia — falta comprobante",
  PENDING_ADMIN_CONFIRM: "Comprobante subido — falta confirmar admin",
  PENDING_NAIROBY_CLOSE: "Transferencia confirmada — falta cerrar",
};

const MONTH_NAME = ["Enero", "Febrero", "Marzo", "Abril", "Mayo", "Junio", "Julio", "Agosto", "Septiembre", "Octubre", "Noviembre", "Diciembre"];
function monthLabel(month: string) {
  const [y, m] = month.split("-");
  return `${MONTH_NAME[Number(m) - 1]} ${y}`;
}
function money(n: number) {
  return `$${n.toFixed(2)}`;
}
function productLabel(o: Order) {
  if (o.items.length > 1) return `${o.items.length} productos`;
  const it = o.items[0];
  return it ? `${it.confirmedProductName ?? it.employeeProductName} × ${it.quantity}` : "producto";
}

const STATE_STYLE: Record<Row["state"], { label: string; color: string }> = {
  cobrada: { label: "Cobrada", color: "#22C55E" },
  "este-mes": { label: "Este mes", color: "#D9A441" },
  pendiente: { label: "Pendiente", color: "#94A3B8" },
};

// Solo para ver — pedido explícito del usuario (2026-08-31): admin y
// Nairoby quieren un solo lugar para ver, mes a mes, cómo va fluyendo el
// cobro automático de las compras personales (rol o transferencia), sin
// entrar orden por orden. Cada cuota de rol se ubica en el mes que le
// corresponde (mismo cálculo que arma el rol de pago real, ver payroll.ts);
// una compra en transferencia es un solo evento, ubicado en el mes en que
// Nairoby la cerró. Lo que todavía no tiene mes asignado (no ha elegido
// método, o transferencia sin cerrar) va aparte, arriba de todo.
export function PersonalPurchasesPaymentLedgerPanel() {
  const [data, setData] = useState<{ currentMonth: string; orders: Order[] } | null>(null);

  useEffect(() => {
    fetch("/api/personal-purchases/payment-ledger").then((r) => (r.ok ? r.json() : null)).then(setData);
  }, []);

  if (!data) return <div className="text-steel text-[13px]">Cargando…</div>;

  const { currentMonth, orders } = data;
  const buckets = new Map<string, Row[]>();
  function push(month: string, row: Row) {
    if (!buckets.has(month)) buckets.set(month, []);
    buckets.get(month)!.push(row);
  }

  for (const o of orders) {
    const employee = o.employee.name;
    const product = productLabel(o);

    if (o.paymentMethod === "PAYROLL" && o.firstPayoutMonth && o.totalAmount != null) {
      for (let i = 0; i < o.installments; i++) {
        const month = addMonthsToMonthStr(o.firstPayoutMonth, i);
        const amount = installmentAmount(o.totalAmount, o.installments, i);
        const state: Row["state"] = month < currentMonth ? "cobrada" : month === currentMonth ? "este-mes" : "pendiente";
        const cuota = o.installments > 1 ? ` (cuota ${i + 1}/${o.installments})` : "";
        push(month, { key: `${o.id}-${i}`, employee, product, amount, detail: `Descuento en rol${cuota}`, state });
      }
      continue;
    }

    if (o.paymentMethod === "TRANSFER" && o.transferClosedAt) {
      const month = o.transferClosedAt.slice(0, 7);
      push(month, { key: o.id, employee, product, amount: o.totalAmount ?? 0, detail: "Transferencia recibida", state: "cobrada" });
      continue;
    }

    // Todavía no tiene mes: no eligió método, o transferencia sin cerrar.
    push(NO_MONTH_BUCKET, {
      key: o.id,
      employee,
      product,
      amount: o.totalAmount ?? 0,
      detail: UNRESOLVED_LABEL[o.status] ?? o.status,
      state: "pendiente",
    });
  }

  const months = [...buckets.keys()].filter((m) => m !== NO_MONTH_BUCKET).sort();
  const totalCobrado = orders.reduce((sum, o) => {
    if (o.paymentMethod === "PAYROLL" && o.firstPayoutMonth && o.totalAmount != null) {
      let s = 0;
      for (let i = 0; i < o.installments; i++) {
        const month = addMonthsToMonthStr(o.firstPayoutMonth, i);
        if (month < currentMonth) s += installmentAmount(o.totalAmount, o.installments, i);
      }
      return sum + s;
    }
    if (o.paymentMethod === "TRANSFER" && o.transferClosedAt) return sum + (o.totalAmount ?? 0);
    return sum;
  }, 0);
  const totalPendiente = orders.reduce((sum, o) => sum + (o.totalAmount ?? 0), 0) - totalCobrado;

  return (
    <div>
      <div className="text-[11px] font-semibold uppercase tracking-wide text-steel mb-3">Compras personales — seguimiento de cobro por mes</div>

      <div className="flex gap-4 flex-wrap mb-4">
        <div className="bg-surface border border-rule rounded-md px-3.5 py-2.5">
          <div className="text-[10.5px] text-steel-dim uppercase tracking-wide">Ya cobrado</div>
          <div className="text-[16px] font-bold" style={{ color: "#22C55E" }}>{money(totalCobrado)}</div>
        </div>
        <div className="bg-surface border border-rule rounded-md px-3.5 py-2.5">
          <div className="text-[10.5px] text-steel-dim uppercase tracking-wide">Falta por cobrar</div>
          <div className="text-[16px] font-bold" style={{ color: "#D9A441" }}>{money(totalPendiente)}</div>
        </div>
      </div>

      {orders.length === 0 ? (
        <div className="border-[1.5px] border-dashed border-rule rounded-md p-6 text-center text-steel text-[13px]">Todavía no hay compras con precio cerrado.</div>
      ) : (
        <div className="flex flex-col gap-5">
          {buckets.has(NO_MONTH_BUCKET) && (
            <div>
              <div className="text-[12px] font-bold text-steel mb-2">Sin mes asignado todavía</div>
              <RowsList rows={buckets.get(NO_MONTH_BUCKET)!} />
            </div>
          )}
          {months.map((month) => (
            <div key={month}>
              <div className="text-[12px] font-bold text-steel mb-2">{monthLabel(month)}{month === currentMonth ? " (mes actual)" : ""}</div>
              <RowsList rows={buckets.get(month)!} />
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function RowsList({ rows }: { rows: Row[] }) {
  return (
    <div className="flex flex-col gap-2">
      {rows.map((r) => {
        const st = STATE_STYLE[r.state];
        return (
          <div key={r.key} className="bg-surface border border-rule rounded-md p-3 flex items-center justify-between gap-3 flex-wrap">
            <div>
              <div className="font-bold text-[13px]">{r.employee}</div>
              <div className="text-[11.5px] text-steel-dim">{r.product} · {r.detail}</div>
            </div>
            <div className="flex items-center gap-2">
              <span className="font-bold text-[13px] tabular-nums">{money(r.amount)}</span>
              <span className="text-[10.5px] font-semibold rounded-full px-2 py-0.5" style={{ color: st.color, border: `1px solid ${st.color}` }}>{st.label}</span>
            </div>
          </div>
        );
      })}
    </div>
  );
}
