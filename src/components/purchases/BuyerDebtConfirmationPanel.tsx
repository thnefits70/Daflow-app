"use client";

import { useEffect, useState } from "react";
import { formatDateTime } from "@/lib/formatDateTime";

type Item = {
  id: string;
  requestNumber: number | null;
  productName: string;
  supplierName: string;
  quantity: number;
  totalCost: number;
  requestedAt: string;
};

function money(n: number) {
  return `$${n.toFixed(2)}`;
}

// Confirmado 2026-09-11: pedido explícito del usuario — para un proveedor de
// crédito (hoy solo CHEN), recibir la mercadería ya no alcanza para que
// cuente en la deuda a pagar: hace falta que quien aprueba compras (hoy
// Bryan) confirme APARTE que él sí autorizó esa compra. Mientras tanto la
// mercadería ya se recibió y está disponible para vender — esto solo
// bloquea que se sume al saldo a pagar.
export function BuyerDebtConfirmationPanel({ canAct }: { canAct: boolean }) {
  const [items, setItems] = useState<Item[] | null>(null);
  const [rejectingId, setRejectingId] = useState<string | null>(null);
  const [rejectReason, setRejectReason] = useState("");
  const [busy, setBusy] = useState(false);

  function load() {
    fetch("/api/purchase-requests/credit-debt-pending").then((r) => (r.ok ? r.json() : [])).then(setItems);
  }
  useEffect(load, []);

  async function confirm(id: string) {
    setBusy(true);
    await fetch(`/api/purchase-requests/${id}/confirm-debt`, { method: "POST" });
    setBusy(false);
    load();
  }

  async function reject(id: string) {
    if (!rejectReason.trim()) return;
    setBusy(true);
    await fetch(`/api/purchase-requests/${id}/reject-debt`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ reason: rejectReason.trim() }),
    });
    setBusy(false);
    setRejectingId(null);
    setRejectReason("");
    load();
  }

  if (!items) return <div className="text-steel text-[13px]">Cargando…</div>;

  return (
    <div>
      <div className="text-[11px] font-semibold uppercase tracking-wide text-steel mb-3">
        Esperando tu confirmación ({items.length})
      </div>
      {items.length === 0 && (
        <div className="border-[1.5px] border-dashed border-rule rounded-md p-6 text-center text-steel text-[13px]">
          Nada pendiente por ahora.
        </div>
      )}
      <div className="flex flex-col gap-2">
        {items.map((i) => (
          <div key={i.id} className="bg-surface border border-rule rounded-md p-3.5">
            <div className="flex items-center gap-3 flex-wrap">
              <span className="font-bold text-[13px]">{i.supplierName}</span>
              <span className="text-[13px]">{i.productName} × {i.quantity}</span>
              <span className="font-bold text-[13px] tabular-nums text-green ml-auto">{money(i.totalCost)}</span>
            </div>
            <div className="text-[11px] text-steel-dim mt-1">
              {i.requestNumber ? `SC-${String(i.requestNumber).padStart(3, "0")} — ` : ""}Recibida el {formatDateTime(i.requestedAt)}
            </div>
            {canAct && (
              rejectingId === i.id ? (
                <div className="mt-2.5 pt-2.5 border-t border-rule">
                  <input
                    className="text-[12px] rounded border border-rule bg-cloud px-2 py-1.5 w-full mb-2"
                    placeholder="¿Por qué no autorizaste esta compra?"
                    value={rejectReason}
                    onChange={(e) => setRejectReason(e.target.value)}
                  />
                  <div className="flex gap-2">
                    <button type="button" disabled={busy || !rejectReason.trim()} className="text-[12px] font-bold bg-red text-white rounded px-3 py-1.5 cursor-pointer disabled:opacity-50" onClick={() => reject(i.id)}>
                      Confirmar que no la autoricé
                    </button>
                    <button type="button" className="text-[12px] text-steel cursor-pointer" onClick={() => { setRejectingId(null); setRejectReason(""); }}>
                      Cancelar
                    </button>
                  </div>
                </div>
              ) : (
                <div className="flex gap-2 mt-2.5 pt-2.5 border-t border-rule">
                  <button type="button" disabled={busy} className="text-[12px] font-bold bg-green text-white rounded px-3 py-1.5 cursor-pointer disabled:opacity-50" onClick={() => confirm(i.id)}>
                    Sí, yo autoricé esta compra
                  </button>
                  <button type="button" disabled={busy} className="text-[12px] font-semibold text-red cursor-pointer" onClick={() => setRejectingId(i.id)}>
                    No la autoricé
                  </button>
                </div>
              )
            )}
          </div>
        ))}
      </div>
    </div>
  );
}
