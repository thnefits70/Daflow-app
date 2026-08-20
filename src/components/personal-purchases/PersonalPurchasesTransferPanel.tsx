"use client";

import { useEffect, useState } from "react";
import { ProofPreview } from "@/components/shared/ProofPreview";

type ConfirmOrder = {
  id: string;
  employee: { name: string };
  totalAmount: number | null;
  transferProofUrl: string | null;
  transferProofName: string | null;
  transferAiMatch: boolean | null;
  transferAiNote: string | null;
};
type CloseOrder = {
  id: string;
  employee: { name: string };
  totalAmount: number | null;
};

function money(n: number | null) {
  return n == null ? "—" : `$${n.toFixed(2)}`;
}

// Confirmado 2026-08-20: dos colas separadas de la misma pantalla —
// "por confirmar" (admin, revisando su cuenta bancaria real, en dos pasos:
// tocar "Confirmar recibido" y después confirmar de nuevo en el cartel) y
// "por cerrar" (Nairoby/FIN o admin, una vez que ya se confirmó el ingreso).
export function PersonalPurchasesTransferPanel({ isAdmin }: { isAdmin: boolean }) {
  const [confirmOrders, setConfirmOrders] = useState<ConfirmOrder[] | null>(null);
  const [closeOrders, setCloseOrders] = useState<CloseOrder[] | null>(null);
  const [confirming, setConfirming] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  function load() {
    if (isAdmin) {
      fetch("/api/personal-purchases/pending-transfer-confirm").then((r) => (r.ok ? r.json() : [])).then(setConfirmOrders);
    }
    fetch("/api/personal-purchases/pending-transfer-close").then((r) => (r.ok ? r.json() : [])).then(setCloseOrders);
  }
  useEffect(load, [isAdmin]);

  async function confirmTransfer(id: string) {
    setBusy(true);
    await fetch(`/api/personal-purchases/${id}/confirm-transfer`, { method: "POST" });
    setBusy(false);
    setConfirming(null);
    load();
  }

  async function closeTransfer(id: string) {
    setBusy(true);
    await fetch(`/api/personal-purchases/${id}/close-transfer`, { method: "POST" });
    setBusy(false);
    load();
  }

  if (confirmOrders === null && closeOrders === null) return null;
  if ((confirmOrders?.length ?? 0) === 0 && (closeOrders?.length ?? 0) === 0) return null;

  return (
    <div className="flex flex-col gap-4">
      {isAdmin && (confirmOrders?.length ?? 0) > 0 && (
        <div>
          <div className="text-[11px] font-semibold uppercase tracking-wide text-steel mb-3">
            Transferencias por confirmar ({confirmOrders!.length})
          </div>
          <div className="flex flex-col gap-3">
            {confirmOrders!.map((o) => (
              <div key={o.id} className="bg-surface border border-rule rounded-md p-3.5">
                <div className="flex items-center justify-between mb-2">
                  <div className="font-bold text-[13px]">{o.employee.name}</div>
                  <div className="font-bold text-[13px] tabular-nums">{money(o.totalAmount)}</div>
                </div>
                {o.transferProofUrl && <ProofPreview url={o.transferProofUrl} filename={o.transferProofName ?? undefined} />}
                {o.transferAiMatch !== null && (
                  <span
                    className="inline-block mt-2 text-[10.5px] font-semibold rounded-full px-2 py-0.5"
                    style={{ color: o.transferAiMatch ? "#22C55E" : "#D9A441", border: `1px solid ${o.transferAiMatch ? "#22C55E" : "#D9A441"}` }}
                  >
                    IA: {o.transferAiNote}
                  </span>
                )}

                {confirming === o.id ? (
                  <div className="mt-3 pt-3 border-t border-rule">
                    <p className="text-[12.5px] mb-2.5">
                      ¿Confirmás que revisaste tu cuenta y ya te llegaron <b>{money(o.totalAmount)}</b> de <b>{o.employee.name}</b>?
                    </p>
                    <div className="flex gap-2">
                      <button type="button" disabled={busy} className="text-[12px] font-bold bg-green text-white rounded px-3.5 py-1.5 cursor-pointer disabled:opacity-50" onClick={() => confirmTransfer(o.id)}>
                        Confirmar definitivo
                      </button>
                      <button type="button" className="text-[12px] text-steel cursor-pointer" onClick={() => setConfirming(null)}>
                        Volver
                      </button>
                    </div>
                  </div>
                ) : (
                  <button type="button" disabled={busy} className="text-[12px] font-bold bg-teal text-white rounded-md px-3.5 py-1.5 cursor-pointer disabled:opacity-40 mt-3" onClick={() => setConfirming(o.id)}>
                    Confirmar recibido
                  </button>
                )}
              </div>
            ))}
          </div>
        </div>
      )}

      {(closeOrders?.length ?? 0) > 0 && (
        <div>
          <div className="text-[11px] font-semibold uppercase tracking-wide text-steel mb-3">
            Transferencias confirmadas — falta cerrar ({closeOrders!.length})
          </div>
          <div className="flex flex-col gap-3">
            {closeOrders!.map((o) => (
              <div key={o.id} className="bg-surface border border-rule rounded-md p-3.5 flex items-center justify-between gap-3">
                <div>
                  <div className="font-bold text-[13px]">{o.employee.name}</div>
                  <div className="text-[12px] text-steel-dim tabular-nums">{money(o.totalAmount)}</div>
                </div>
                {isAdmin ? (
                  <span className="text-[11px] text-steel-dim italic">Esperando que Nairoby cierre</span>
                ) : (
                  <button type="button" disabled={busy} className="text-[12px] font-bold bg-teal text-white rounded-md px-3.5 py-1.5 cursor-pointer disabled:opacity-40" onClick={() => closeTransfer(o.id)}>
                    Cerrar transacción
                  </button>
                )}
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
