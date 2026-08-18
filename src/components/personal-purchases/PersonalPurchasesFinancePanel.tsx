"use client";

import { useEffect, useState } from "react";

type Item = {
  id: string;
  quantity: number;
  unitPrice: number;
  totalAmount: number;
  installments: number;
  priceMode: string;
  employee: { name: string };
  product: { name: string };
};

function money(n: number) {
  return `$${n.toFixed(2)}`;
}

// Confirmado 2026-08-18: pantalla de Nairoby/admin — cierra el precio final
// (ya confirmado por Daniel que se puede retirar) y activa el descuento
// real en el rol de pago, con el mismo desfase de un mes que todo lo demás.
export function PersonalPurchasesFinancePanel() {
  const [items, setItems] = useState<Item[] | null>(null);
  const [overrides, setOverrides] = useState<Record<string, string>>({});
  const [rejecting, setRejecting] = useState<string | null>(null);
  const [rejectReason, setRejectReason] = useState("");
  const [busy, setBusy] = useState(false);

  function load() {
    fetch("/api/personal-purchases/pending-finance").then((r) => (r.ok ? r.json() : [])).then(setItems);
  }
  useEffect(load, []);

  async function confirm(it: Item) {
    setBusy(true);
    const override = overrides[it.id];
    const finalUnitPrice = override ? Number(override) : undefined;
    await fetch(`/api/personal-purchases/${it.id}/confirm-finance`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(finalUnitPrice ? { finalUnitPrice } : {}),
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

  if (!items) return <div className="text-steel text-[13px]">Cargando…</div>;

  return (
    <div>
      <div className="text-[11px] font-semibold uppercase tracking-wide text-steel mb-3">Compras personales — cerrar precio ({items.length})</div>
      {items.length === 0 && <div className="border-[1.5px] border-dashed border-rule rounded-md p-6 text-center text-steel text-[13px]">Nada pendiente por ahora.</div>}
      <div className="flex flex-col gap-3">
        {items.map((it) => (
          <div key={it.id} className="bg-surface border border-rule rounded-md p-3.5">
            <div className="font-bold text-[13px]">{it.employee.name}</div>
            <div className="text-[12.5px]">{it.product.name} × {it.quantity} — {it.priceMode === "COST" ? "precio al costo" : "precio Dropi"}{it.installments > 1 ? ` (${it.installments} cuotas)` : ""}</div>
            <div className="flex items-center gap-2 mt-1.5">
              <span className="text-[11.5px] text-steel">Precio unitario calculado: {money(it.unitPrice)}</span>
              <input
                className="text-[12px] rounded border border-rule bg-cloud px-2 py-1 w-24"
                type="number"
                step="0.01"
                placeholder="Ajustar"
                value={overrides[it.id] ?? ""}
                onChange={(e) => setOverrides((o) => ({ ...o, [it.id]: e.target.value }))}
              />
            </div>
            {rejecting === it.id ? (
              <div className="mt-3 pt-3 border-t border-rule">
                <input className="text-[12px] rounded border border-rule bg-cloud px-2 py-1.5 w-full mb-2" placeholder="Motivo del rechazo" value={rejectReason} onChange={(e) => setRejectReason(e.target.value)} />
                <div className="flex gap-2">
                  <button type="button" disabled={busy || !rejectReason.trim()} className="text-[12px] font-bold bg-red text-white rounded px-3 py-1.5 cursor-pointer disabled:opacity-50" onClick={() => reject(it.id)}>Confirmar rechazo</button>
                  <button type="button" className="text-[12px] text-steel cursor-pointer" onClick={() => { setRejecting(null); setRejectReason(""); }}>Cancelar</button>
                </div>
              </div>
            ) : (
              <div className="flex gap-2 mt-2.5">
                <button type="button" disabled={busy} className="text-[12px] font-bold bg-green text-white rounded-md px-3.5 py-1.5 cursor-pointer disabled:opacity-50" onClick={() => confirm(it)}>Confirmar y activar descuento</button>
                <button type="button" disabled={busy} className="text-[12px] font-semibold text-red cursor-pointer" onClick={() => setRejecting(it.id)}>Rechazar</button>
              </div>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}
