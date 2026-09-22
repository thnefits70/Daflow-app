"use client";

import { useEffect, useState } from "react";
import { ProofPreview } from "@/components/shared/ProofPreview";
import { CatalogCode } from "@/components/shared/CatalogCode";

type ConfirmOrder = {
  id: string;
  employee: { name: string };
  totalAmount: number | null;
  transferProofUrl: string | null;
  transferProofName: string | null;
  transferAiMatch: boolean | null;
  transferAiNote: string | null;
};
type ItemWithPhoto = { confirmedProductName: string | null; employeeProductName: string; quantity: number; livePhotoUrl: string; optionalPhotoUrl: string | null; confirmedCatalogItem: { justCode: string | null } | null };
type CloseOrder = {
  id: string;
  employee: { name: string };
  totalAmount: number | null;
  transferProofUrl: string | null;
  transferProofName: string | null;
  items: ItemWithPhoto[];
};
type CashOrder = {
  id: string;
  employee: { name: string };
  totalAmount: number | null;
  items: ItemWithPhoto[];
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
  const [cashOrders, setCashOrders] = useState<CashOrder[] | null>(null);
  const [confirming, setConfirming] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [zoomedPhoto, setZoomedPhoto] = useState<string | null>(null);

  function load() {
    if (isAdmin) {
      fetch("/api/personal-purchases/pending-transfer-confirm").then((r) => (r.ok ? r.json() : [])).then(setConfirmOrders);
    }
    fetch("/api/personal-purchases/pending-transfer-close").then((r) => (r.ok ? r.json() : [])).then(setCloseOrders);
    fetch("/api/personal-purchases/pending-cash-confirm").then((r) => (r.ok ? r.json() : [])).then(setCashOrders);
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

  // Confirmado 2026-09-07: un solo clic — a diferencia de transferencia, acá
  // no hay comprobante ni segundo paso: Nairoby ya tiene el efectivo en mano,
  // así que este clic confirma la recepción Y sube el monto a Caja Chica
  // Principal en el mismo movimiento (ver confirm-cash/route.ts).
  async function confirmCash(id: string) {
    setBusy(true);
    await fetch(`/api/personal-purchases/${id}/confirm-cash`, { method: "POST" });
    setBusy(false);
    load();
  }

  if (confirmOrders === null && closeOrders === null && cashOrders === null) return null;
  if ((confirmOrders?.length ?? 0) === 0 && (closeOrders?.length ?? 0) === 0 && (cashOrders?.length ?? 0) === 0) return null;

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
              <div key={o.id} className="bg-surface border border-rule rounded-md p-3.5">
                <div className="flex items-center justify-between gap-3 mb-2.5">
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
                <ItemsWithPhotos items={o.items} onZoom={setZoomedPhoto} />
                {o.transferProofUrl && <ProofPreview url={o.transferProofUrl} filename={o.transferProofName ?? undefined} />}
              </div>
            ))}
          </div>
        </div>
      )}

      {(cashOrders?.length ?? 0) > 0 && (
        <div>
          <div className="text-[11px] font-semibold uppercase tracking-wide text-steel mb-3">
            Efectivo — falta confirmar recepción ({cashOrders!.length})
          </div>
          <div className="flex flex-col gap-3">
            {cashOrders!.map((o) => (
              <div key={o.id} className="bg-surface border border-rule rounded-md p-3.5">
                <div className="flex items-center justify-between gap-3 mb-2.5">
                  <div>
                    <div className="font-bold text-[13px]">{o.employee.name}</div>
                    <div className="text-[12px] text-steel-dim tabular-nums">{money(o.totalAmount)}</div>
                  </div>
                  {isAdmin ? (
                    <span className="text-[11px] text-steel-dim italic">Esperando que Nairoby confirme</span>
                  ) : (
                    <button type="button" disabled={busy} className="text-[12px] font-bold bg-teal text-white rounded-md px-3.5 py-1.5 cursor-pointer disabled:opacity-40" onClick={() => confirmCash(o.id)}>
                      💵 Confirmé que recibí — subir a caja chica
                    </button>
                  )}
                </div>
                <ItemsWithPhotos items={o.items} onZoom={setZoomedPhoto} />
              </div>
            ))}
          </div>
        </div>
      )}
      {zoomedPhoto && (
        <div
          className="fixed inset-0 z-50 bg-black/80 flex items-center justify-center p-6 cursor-zoom-out"
          onClick={() => setZoomedPhoto(null)}
        >
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={zoomedPhoto} alt="Foto ampliada" className="max-w-full max-h-full object-contain rounded-md" />
        </div>
      )}
    </div>
  );
}

function ItemsWithPhotos({ items, onZoom }: { items: ItemWithPhoto[]; onZoom: (url: string) => void }) {
  return (
    <div className="flex flex-col gap-1.5 mb-2">
      {items.map((it, i) => (
        <div key={i} className="flex items-center gap-2 text-[11.5px] text-steel-dim">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src={it.livePhotoUrl}
            alt="Foto del producto"
            className="w-10 h-10 object-cover rounded-md border border-rule shrink-0 cursor-zoom-in"
            onDoubleClick={() => onZoom(it.livePhotoUrl)}
            onClick={() => onZoom(it.livePhotoUrl)}
          />
          {it.optionalPhotoUrl && (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={it.optionalPhotoUrl}
              alt="Foto extra"
              className="w-10 h-10 object-cover rounded-md border border-rule shrink-0 cursor-zoom-in"
              onDoubleClick={() => onZoom(it.optionalPhotoUrl!)}
              onClick={() => onZoom(it.optionalPhotoUrl!)}
            />
          )}
          <span className="inline-flex items-center gap-1 min-w-0">
            <CatalogCode code={it.confirmedCatalogItem?.justCode} />
            <span className="truncate">{it.confirmedProductName ?? it.employeeProductName} × {it.quantity}</span>
          </span>
        </div>
      ))}
    </div>
  );
}
