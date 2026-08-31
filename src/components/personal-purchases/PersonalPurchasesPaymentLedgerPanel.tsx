"use client";

import { useEffect, useState } from "react";

type Row = {
  key: string;
  employee: string;
  product: string;
  amount: number;
  detail: string;
  state: "cobrada" | "en-curso" | "pendiente";
};

type LedgerData = {
  currentMonth: string;
  totals: { cobrado: number; pendiente: number };
  noMonthRows: Row[];
  months: { month: string; rows: Row[] }[];
};

const MONTH_NAME = ["Enero", "Febrero", "Marzo", "Abril", "Mayo", "Junio", "Julio", "Agosto", "Septiembre", "Octubre", "Noviembre", "Diciembre"];
function monthLabel(month: string) {
  const [y, m] = month.split("-");
  return `${MONTH_NAME[Number(m) - 1]} ${y}`;
}
function money(n: number) {
  return `$${n.toFixed(2)}`;
}

const STATE_STYLE: Record<Row["state"], { label: string; color: string }> = {
  cobrada: { label: "Cobrada", color: "#22C55E" },
  "en-curso": { label: "En curso", color: "#D9A441" },
  pendiente: { label: "Pendiente", color: "#94A3B8" },
};

// Solo para ver — pedido explícito del usuario (2026-08-31): admin y
// Nairoby quieren un solo lugar para ver, mes a mes, cómo va fluyendo el
// cobro automático de las compras personales (rol o transferencia), sin
// entrar orden por orden. Corregido el mismo día: "cobrada" ya no es un
// supuesto de calendario, viene calculado en el servidor cruzando contra
// el pago individual real confirmado (PayrollQuincenaRole.paidAt) o el
// cierre real de la transferencia (transferClosedAt) — ver
// payment-ledger/route.ts.
export function PersonalPurchasesPaymentLedgerPanel() {
  const [data, setData] = useState<LedgerData | null>(null);

  useEffect(() => {
    fetch("/api/personal-purchases/payment-ledger").then((r) => (r.ok ? r.json() : null)).then(setData);
  }, []);

  if (!data) return <div className="text-steel text-[13px]">Cargando…</div>;

  const { currentMonth, totals, noMonthRows, months } = data;
  const isEmpty = noMonthRows.length === 0 && months.length === 0;

  return (
    <div>
      <div className="text-[11px] font-semibold uppercase tracking-wide text-steel mb-3">Compras personales — seguimiento de cobro por mes</div>

      <div className="flex gap-4 flex-wrap mb-4">
        <div className="bg-surface border border-rule rounded-md px-3.5 py-2.5">
          <div className="text-[10.5px] text-steel-dim uppercase tracking-wide">Ya cobrado (confirmado)</div>
          <div className="text-[16px] font-bold" style={{ color: "#22C55E" }}>{money(totals.cobrado)}</div>
        </div>
        <div className="bg-surface border border-rule rounded-md px-3.5 py-2.5">
          <div className="text-[10.5px] text-steel-dim uppercase tracking-wide">Falta por cobrar</div>
          <div className="text-[16px] font-bold" style={{ color: "#D9A441" }}>{money(totals.pendiente)}</div>
        </div>
      </div>

      {isEmpty ? (
        <div className="border-[1.5px] border-dashed border-rule rounded-md p-6 text-center text-steel text-[13px]">Todavía no hay compras con precio cerrado.</div>
      ) : (
        <div className="flex flex-col gap-5">
          {noMonthRows.length > 0 && (
            <div>
              <div className="text-[12px] font-bold text-steel mb-2">Sin mes asignado todavía</div>
              <RowsList rows={noMonthRows} />
            </div>
          )}
          {months.map(({ month, rows }) => (
            <div key={month}>
              <div className="text-[12px] font-bold text-steel mb-2">{monthLabel(month)}{month === currentMonth ? " (mes actual)" : ""}</div>
              <RowsList rows={rows} />
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
