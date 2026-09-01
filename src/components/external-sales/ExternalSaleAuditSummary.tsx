"use client";

import { useEffect, useState } from "react";
import { formatDateTime } from "@/lib/formatDateTime";

type AuditSaleDTO = {
  id: string;
  code: string;
  declaredProductName: string;
  catalogItem: { name: string } | null;
  quantity: number;
  totalAmount: number;
  isContraEntrega: boolean;
  createdAt: string;
  nairobyClosedAt: string;
  advisor: { name: string } | null;
};

type AuditSummaryDTO = {
  totals: {
    count: number;
    amount: number;
    b2b: { count: number; amount: number };
    b2c: { count: number; amount: number };
  };
  byAdvisor: { name: string; count: number; amount: number }[];
  sales: AuditSaleDTO[];
};

function money(n: number) {
  return `$${n.toFixed(2)}`;
}

export function ExternalSaleAuditSummary() {
  const [data, setData] = useState<AuditSummaryDTO | null>(null);

  useEffect(() => {
    fetch("/api/external-sales/audit-summary")
      .then((r) => (r.ok ? r.json() : null))
      .then(setData)
      .catch(() => null);
  }, []);

  if (data === null) return <div className="text-[13px] text-steel">Cargando…</div>;
  if (data.totals.count === 0) return <div className="text-[13px] text-steel">Todavía no hay ventas externas cerradas.</div>;

  return (
    <div className="flex flex-col gap-6 max-w-2xl">
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-2.5">
        <div className="bg-surface border border-rule rounded-md p-3">
          <div className="text-[10px] font-semibold uppercase tracking-wide text-steel mb-1">Cerradas</div>
          <div className="font-mono text-[18px] font-bold tabular-nums">{data.totals.count}</div>
        </div>
        <div className="bg-surface border border-rule rounded-md p-3">
          <div className="text-[10px] font-semibold uppercase tracking-wide text-steel mb-1">Monto total</div>
          <div className="font-mono text-[18px] font-bold tabular-nums text-teal">{money(data.totals.amount)}</div>
        </div>
        <div className="bg-surface border border-rule rounded-md p-3">
          <div className="text-[10px] font-semibold uppercase tracking-wide text-steel mb-1">B2B (anticipado)</div>
          <div className="font-mono text-[15px] font-bold tabular-nums">{data.totals.b2b.count} · {money(data.totals.b2b.amount)}</div>
        </div>
        <div className="bg-surface border border-rule rounded-md p-3">
          <div className="text-[10px] font-semibold uppercase tracking-wide text-steel mb-1">B2C (contra entrega)</div>
          <div className="font-mono text-[15px] font-bold tabular-nums">{data.totals.b2c.count} · {money(data.totals.b2c.amount)}</div>
        </div>
      </div>

      <div>
        <div className="font-display font-bold text-[14px] mb-2.5">Por asesor</div>
        <div className="flex flex-col gap-1.5">
          {data.byAdvisor.map((a) => (
            <div key={a.name} className="flex items-center justify-between bg-surface border border-rule rounded-md px-3 py-2 text-[13px]">
              <span className="font-semibold">{a.name}</span>
              <span className="font-mono tabular-nums text-steel">{a.count} venta{a.count === 1 ? "" : "s"} · {money(a.amount)}</span>
            </div>
          ))}
        </div>
      </div>

      <div>
        <div className="font-display font-bold text-[14px] mb-2.5">Registro de ventas cerradas</div>
        <div className="flex flex-col gap-1.5">
          {data.sales.map((s) => (
            <div key={s.id} className="bg-surface border border-rule rounded-md p-2.5 text-[12px]">
              <div className="flex items-center gap-2 flex-wrap">
                <span className="font-mono font-bold text-teal">{s.code}</span>
                <span className="text-steel">{s.advisor?.name ?? "—"}</span>
                <span className={`font-mono text-[9.5px] font-bold uppercase ${s.isContraEntrega ? "text-blue" : "text-green"}`}>
                  {s.isContraEntrega ? "Contra entrega" : "Anticipado"}
                </span>
              </div>
              <div className="font-semibold mt-0.5">
                {s.catalogItem?.name ?? s.declaredProductName} — {s.quantity} un. · <span className="font-mono tabular-nums">{money(s.totalAmount)}</span>
              </div>
              <div className="text-steel mt-0.5">Cerrada el {formatDateTime(s.nairobyClosedAt)}</div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
