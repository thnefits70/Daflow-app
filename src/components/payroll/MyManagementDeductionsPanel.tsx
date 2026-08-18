"use client";

import { useEffect, useState } from "react";

type Deduction = {
  id: string;
  totalAmount: number;
  reason: string;
  evidenceUrl: string | null;
  installments: number;
  startMonth: string;
  acceptedAt: string | null;
};

function money(n: number) {
  return `$${n.toFixed(2)}`;
}

// Confirmado 2026-08-18: el colaborador tiene que aceptar explícitamente
// cada descuento por mala gestión antes de que se aplique a su rol — esta
// aceptación queda como constancia.
export function MyManagementDeductionsPanel() {
  const [items, setItems] = useState<Deduction[] | null>(null);
  const [busy, setBusy] = useState(false);

  function load() {
    fetch("/api/management-deductions").then((r) => (r.ok ? r.json() : [])).then(setItems);
  }
  useEffect(load, []);

  async function accept(id: string) {
    setBusy(true);
    await fetch(`/api/management-deductions/${id}/accept`, { method: "POST" });
    setBusy(false);
    load();
  }

  if (!items || items.length === 0) return null;

  return (
    <div className="bg-surface border border-rule rounded-md p-4 mb-4">
      <div className="text-[11px] font-semibold uppercase tracking-wide text-steel mb-3">Descuentos por confirmar</div>
      <div className="flex flex-col gap-3">
        {items.map((d) => (
          <div key={d.id} className="border border-rule rounded-md p-3">
            <div className="font-bold text-[13px]">{money(d.totalAmount)}{d.installments > 1 ? ` — ${d.installments} cuotas de ${money(d.totalAmount / d.installments)}, desde ${d.startMonth}` : ` — en ${d.startMonth}`}</div>
            <div className="text-[12.5px] text-steel-dim mt-1">{d.reason}</div>
            {d.evidenceUrl && <a href={d.evidenceUrl} target="_blank" rel="noopener noreferrer" className="text-[11.5px] text-blue font-semibold">Ver evidencia</a>}
            {d.acceptedAt ? (
              <div className="text-[11px] text-green font-semibold mt-2">Aceptado</div>
            ) : (
              <button type="button" disabled={busy} className="text-[12px] font-bold bg-blue text-white rounded px-3 py-1.5 cursor-pointer disabled:opacity-50 mt-2.5" onClick={() => accept(d.id)}>
                Aceptar
              </button>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}
