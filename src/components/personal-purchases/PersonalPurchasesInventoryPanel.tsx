"use client";

import { useEffect, useState } from "react";

type Item = {
  id: string;
  quantity: number;
  priceMode: string;
  livePhotoUrl: string;
  buyerRelation: string;
  buyerNote: string | null;
  employee: { name: string };
  product: { name: string; photo: string | null };
};

const RELATION_LABEL: Record<string, string> = { SELF: "Para él/ella mismo/a", MINOR_CHILD: "Para su hijo/a menor", OTHER_FAMILY: "Para otro familiar" };

// Confirmado 2026-08-18: pantalla de Daniel (Inventario) — confirmar acá es
// lo que habilita que la persona pueda retirar físicamente de bodega.
export function PersonalPurchasesInventoryPanel() {
  const [items, setItems] = useState<Item[] | null>(null);
  const [rejecting, setRejecting] = useState<string | null>(null);
  const [rejectReason, setRejectReason] = useState("");
  const [busy, setBusy] = useState(false);

  function load() {
    fetch("/api/personal-purchases/pending-inventory").then((r) => (r.ok ? r.json() : [])).then(setItems);
  }
  useEffect(load, []);

  async function confirm(id: string) {
    setBusy(true);
    await fetch(`/api/personal-purchases/${id}/confirm-inventory`, { method: "POST" });
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
      <div className="text-[11px] font-semibold uppercase tracking-wide text-steel mb-3">Compras personales pendientes ({items.length})</div>
      {items.length === 0 && <div className="border-[1.5px] border-dashed border-rule rounded-md p-6 text-center text-steel text-[13px]">Nada pendiente por ahora.</div>}
      <div className="flex flex-col gap-3">
        {items.map((it) => (
          <div key={it.id} className="bg-surface border border-rule rounded-md p-3.5">
            <div className="flex gap-3 items-start">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={it.livePhotoUrl} alt="Foto de la compra" className="w-20 h-20 object-cover rounded-md border border-rule shrink-0" />
              <div className="flex-1 min-w-0">
                <div className="font-bold text-[13px]">{it.employee.name}</div>
                <div className="text-[12.5px]">{it.product.name} × {it.quantity}</div>
                <div className="text-[11px] text-steel-dim">
                  <span className={it.priceMode === "COST" ? "text-green font-semibold" : "font-semibold"}>{it.priceMode === "COST" ? "Precio al costo" : "Precio Dropi"}</span> · {RELATION_LABEL[it.buyerRelation]}{it.buyerNote ? ` — ${it.buyerNote}` : ""}
                </div>
              </div>
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
              <div className="flex gap-2 mt-3">
                <button type="button" disabled={busy} className="text-[12px] font-bold bg-green text-white rounded-md px-3.5 py-1.5 cursor-pointer disabled:opacity-50" onClick={() => confirm(it.id)}>Confirmar — habilitar retiro</button>
                <button type="button" disabled={busy} className="text-[12px] font-semibold text-red cursor-pointer" onClick={() => setRejecting(it.id)}>Rechazar</button>
              </div>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}
