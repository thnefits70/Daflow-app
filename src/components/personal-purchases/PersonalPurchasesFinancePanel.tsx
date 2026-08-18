"use client";

import { useEffect, useState } from "react";

type Item = {
  id: string;
  quantity: number;
  priceMode: string;
  buyerRelation: string;
  buyerNote: string | null;
  employee: { name: string };
  product: { name: string };
};

function money(n: number) {
  return `$${n.toFixed(2)}`;
}

const RELATION_LABEL: Record<string, string> = { SELF: "Para él/ella mismo/a", MINOR_CHILD: "Para su hijo/a menor", OTHER_FAMILY: "Para otro familiar" };

// Confirmado 2026-08-18 (ajustado el mismo día): Nairoby/admin es quien
// DIGITA el precio en dólares acá — ya confirmado por Daniel que se puede
// retirar. Ella ve el modo declarado (costo/Dropi) y para quién es, escribe
// el precio unitario, y si el total da $25 o más puede ofrecer 2 cuotas.
export function PersonalPurchasesFinancePanel() {
  const [items, setItems] = useState<Item[] | null>(null);
  const [prices, setPrices] = useState<Record<string, string>>({});
  const [installmentsById, setInstallmentsById] = useState<Record<string, number>>({});
  const [rejecting, setRejecting] = useState<string | null>(null);
  const [rejectReason, setRejectReason] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<Record<string, string>>({});

  function load() {
    fetch("/api/personal-purchases/pending-finance").then((r) => (r.ok ? r.json() : [])).then(setItems);
  }
  useEffect(load, []);

  async function confirm(it: Item) {
    const unitPrice = Number(prices[it.id]);
    if (!unitPrice || unitPrice <= 0) return;
    setBusy(true);
    setErr((e) => ({ ...e, [it.id]: "" }));
    const res = await fetch(`/api/personal-purchases/${it.id}/confirm-finance`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ unitPrice, installments: installmentsById[it.id] ?? 1 }),
    });
    setBusy(false);
    const data = await res.json().catch(() => null);
    if (!res.ok) { setErr((e) => ({ ...e, [it.id]: data?.error ?? "No se pudo confirmar." })); return; }
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
        {items.map((it) => {
          const unitPrice = Number(prices[it.id] || 0);
          const total = unitPrice * it.quantity;
          const installments = installmentsById[it.id] ?? 1;
          return (
            <div key={it.id} className="bg-surface border border-rule rounded-md p-3.5">
              <div className="font-bold text-[13px]">{it.employee.name}</div>
              <div className="text-[12.5px]">{it.product.name} × {it.quantity}</div>
              <div className="text-[11px] text-steel-dim mb-2">
                <span className={it.priceMode === "COST" ? "text-green font-semibold" : "font-semibold"}>{it.priceMode === "COST" ? "Precio al costo" : "Precio Dropi"}</span> · {RELATION_LABEL[it.buyerRelation]}{it.buyerNote ? ` — ${it.buyerNote}` : ""}
              </div>
              <div className="flex items-center gap-2 flex-wrap">
                <label className="text-[11.5px] text-steel">Precio unitario</label>
                <input
                  className="text-[12px] rounded border border-rule bg-cloud px-2 py-1 w-24"
                  type="number"
                  step="0.01"
                  placeholder="$0.00"
                  value={prices[it.id] ?? ""}
                  onChange={(e) => setPrices((p) => ({ ...p, [it.id]: e.target.value }))}
                />
                {unitPrice > 0 && <span className="text-[12px] font-bold">Total: {money(total)}</span>}
                {total >= 25 && (
                  <label className="flex items-center gap-1.5 text-[11.5px]">
                    <input type="checkbox" checked={installments === 2} onChange={(e) => setInstallmentsById((s) => ({ ...s, [it.id]: e.target.checked ? 2 : 1 }))} />
                    Pagar en 2 cuotas
                  </label>
                )}
              </div>
              {err[it.id] && <div className="text-red text-[11.5px] mt-1.5">{err[it.id]}</div>}

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
                  <button type="button" disabled={busy || !(unitPrice > 0)} className="text-[12px] font-bold bg-green text-white rounded-md px-3.5 py-1.5 cursor-pointer disabled:opacity-40" onClick={() => confirm(it)}>Confirmar y activar descuento</button>
                  <button type="button" disabled={busy} className="text-[12px] font-semibold text-red cursor-pointer" onClick={() => setRejecting(it.id)}>Rechazar</button>
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
