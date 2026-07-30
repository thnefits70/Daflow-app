"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { FileText } from "lucide-react";

type Row = {
  id: string;
  groupId: string;
  quantity: number;
  unitCost: number;
  totalCost: number;
  justification: string | null;
  quoteImageUrl: string;
  purchaseOrderUrl: string | null;
  catalogItem: { name: string };
  supplier: { name: string };
};

function isPdf(url: string) {
  return /\.pdf($|\?)/i.test(url);
}

function groupRows(rows: Row[]) {
  const map = new Map<string, Row[]>();
  for (const r of rows) {
    if (!map.has(r.groupId)) map.set(r.groupId, []);
    map.get(r.groupId)!.push(r);
  }
  return [...map.values()];
}

export function PurchaseApprovalInbox() {
  const router = useRouter();
  const [rows, setRows] = useState<Row[] | null>(null);
  const [busyGroup, setBusyGroup] = useState<string | null>(null);
  const [rejectingGroup, setRejectingGroup] = useState<string | null>(null);
  const [rejectReason, setRejectReason] = useState("");

  function load() {
    fetch("/api/purchase-requests?view=approval")
      .then((r) => (r.ok ? r.json() : []))
      .then(setRows)
      .catch(() => setRows([]));
  }
  useEffect(load, []);

  async function review(groupId: string, action: "approve" | "reject") {
    setBusyGroup(groupId);
    await fetch(`/api/purchase-requests/group/${groupId}/review`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action, rejectReason: action === "reject" ? rejectReason.trim() : undefined }),
    });
    setBusyGroup(null);
    setRejectingGroup(null);
    setRejectReason("");
    load();
    router.refresh();
  }

  if (!rows) return <div className="text-steel text-[13px]">Cargando…</div>;
  if (rows.length === 0) return <div className="border-[1.5px] border-dashed border-rule rounded-md p-8 text-center text-steel text-[13.5px]">No hay solicitudes pendientes de aprobar.</div>;

  const groups = groupRows(rows);

  return (
    <div className="flex flex-col gap-2.5">
      {groups.map((g) => {
        const groupId = g[0].groupId;
        const total = g.reduce((s, r) => s + r.totalCost, 0);
        const justification = g.find((r) => r.justification)?.justification ?? null;
        return (
          <div key={groupId} className="bg-surface border border-rule rounded-md p-4">
            <div className="flex items-start justify-between gap-3 flex-wrap mb-1.5">
              <div>
                {g.map((r) => (
                  <div key={r.id} className="text-[14px] font-bold">{r.catalogItem.name} · {r.quantity} un. — ${r.unitCost.toFixed(2)}/un.</div>
                ))}
                <div className="text-[11.5px] text-steel mt-0.5">{g[0].supplier.name} · Total ${total.toFixed(2)}</div>
              </div>
              {justification && (
                <span className="text-[10px] font-bold uppercase tracking-wide bg-red/15 text-red border border-red/40 rounded-full px-2.5 py-1">Sobre el historial</span>
              )}
            </div>
            {justification && <div className="text-[12px] text-steel mb-2.5">Justificación: &quot;{justification}&quot;</div>}
            <div className="flex items-center gap-2 mb-2.5">
              <a href={g[0].quoteImageUrl} target="_blank" rel="noopener noreferrer" className="flex items-center gap-1.5 text-[11.5px] text-blue font-semibold cursor-pointer">
                {isPdf(g[0].quoteImageUrl) ? <FileText size={13} /> : <img src={g[0].quoteImageUrl} alt="" className="w-6 h-6 rounded object-cover border border-rule" />}
                Ver cotización
              </a>
              {g[0].purchaseOrderUrl && (
                <a href={g[0].purchaseOrderUrl} target="_blank" rel="noopener noreferrer" className="flex items-center gap-1.5 text-[11.5px] text-blue font-semibold cursor-pointer">
                  {isPdf(g[0].purchaseOrderUrl) ? <FileText size={13} /> : <img src={g[0].purchaseOrderUrl} alt="" className="w-6 h-6 rounded object-cover border border-rule" />}
                  Ver orden de compra
                </a>
              )}
            </div>
            {rejectingGroup === groupId ? (
              <div>
                <textarea className="w-full rounded border border-rule px-2.5 py-2 text-[12.5px] mb-2" rows={2} placeholder="Motivo del rechazo (opcional)" value={rejectReason} onChange={(e) => setRejectReason(e.target.value)} />
                <div className="flex items-center gap-2">
                  <button type="button" disabled={busyGroup === groupId} className="rounded border border-red bg-red px-3 py-1.5 text-[12px] font-semibold text-white cursor-pointer disabled:opacity-60" onClick={() => review(groupId, "reject")}>
                    Confirmar rechazo
                  </button>
                  <button type="button" className="text-steel text-[12px] cursor-pointer" onClick={() => setRejectingGroup(null)}>Cancelar</button>
                </div>
              </div>
            ) : (
              <div className="flex items-center gap-2">
                <button type="button" disabled={busyGroup === groupId} className="rounded border border-green bg-green px-3.5 py-1.5 text-[12.5px] font-semibold text-white cursor-pointer disabled:opacity-60" onClick={() => review(groupId, "approve")}>
                  Aprobar
                </button>
                <button type="button" disabled={busyGroup === groupId} className="rounded border border-rule px-3.5 py-1.5 text-[12.5px] font-semibold text-steel cursor-pointer" onClick={() => setRejectingGroup(groupId)}>
                  Rechazar
                </button>
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}
