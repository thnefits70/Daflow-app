"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";

type Row = {
  id: string;
  quantity: number;
  unitCost: number;
  totalCost: number;
  justification: string | null;
  catalogItem: { name: string };
  supplier: { name: string };
};

export function PurchaseApprovalInbox() {
  const router = useRouter();
  const [rows, setRows] = useState<Row[] | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [rejectingId, setRejectingId] = useState<string | null>(null);
  const [rejectReason, setRejectReason] = useState("");

  function load() {
    fetch("/api/purchase-requests?view=approval")
      .then((r) => (r.ok ? r.json() : []))
      .then(setRows)
      .catch(() => setRows([]));
  }
  useEffect(load, []);

  async function review(id: string, action: "approve" | "reject") {
    setBusyId(id);
    await fetch(`/api/purchase-requests/${id}/review`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action, rejectReason: action === "reject" ? rejectReason.trim() : undefined }),
    });
    setBusyId(null);
    setRejectingId(null);
    setRejectReason("");
    load();
    router.refresh();
  }

  if (!rows) return <div className="text-steel text-[13px]">Cargando…</div>;
  if (rows.length === 0) return <div className="border-[1.5px] border-dashed border-rule rounded-md p-8 text-center text-steel text-[13.5px]">No hay solicitudes pendientes de aprobar.</div>;

  return (
    <div className="flex flex-col gap-2.5">
      {rows.map((r) => (
        <div key={r.id} className="bg-surface border border-rule rounded-md p-4">
          <div className="flex items-start justify-between gap-3 flex-wrap mb-1.5">
            <div>
              <div className="text-[14px] font-bold">{r.catalogItem.name} · {r.quantity} un.</div>
              <div className="text-[11.5px] text-steel">{r.supplier.name} — ${r.unitCost.toFixed(2)}/unidad · Total ${r.totalCost.toFixed(2)}</div>
            </div>
            {r.justification && (
              <span className="text-[10px] font-bold uppercase tracking-wide bg-red/15 text-red border border-red/40 rounded-full px-2.5 py-1">Sobre el historial</span>
            )}
          </div>
          {r.justification && <div className="text-[12px] text-steel mb-2.5">Justificación: &quot;{r.justification}&quot;</div>}
          {rejectingId === r.id ? (
            <div>
              <textarea className="w-full rounded border border-rule px-2.5 py-2 text-[12.5px] mb-2" rows={2} placeholder="Motivo del rechazo (opcional)" value={rejectReason} onChange={(e) => setRejectReason(e.target.value)} />
              <div className="flex items-center gap-2">
                <button type="button" disabled={busyId === r.id} className="rounded border border-red bg-red px-3 py-1.5 text-[12px] font-semibold text-white cursor-pointer disabled:opacity-60" onClick={() => review(r.id, "reject")}>
                  Confirmar rechazo
                </button>
                <button type="button" className="text-steel text-[12px] cursor-pointer" onClick={() => setRejectingId(null)}>Cancelar</button>
              </div>
            </div>
          ) : (
            <div className="flex items-center gap-2">
              <button type="button" disabled={busyId === r.id} className="rounded border border-green bg-green px-3.5 py-1.5 text-[12.5px] font-semibold text-white cursor-pointer disabled:opacity-60" onClick={() => review(r.id, "approve")}>
                Aprobar
              </button>
              <button type="button" disabled={busyId === r.id} className="rounded border border-rule px-3.5 py-1.5 text-[12.5px] font-semibold text-steel cursor-pointer" onClick={() => setRejectingId(r.id)}>
                Rechazar
              </button>
            </div>
          )}
        </div>
      ))}
    </div>
  );
}
