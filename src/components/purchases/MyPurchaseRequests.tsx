"use client";

import { useEffect, useState } from "react";

type Row = {
  id: string;
  groupId: string;
  status: "PENDING_APPROVAL" | "REJECTED" | "APPROVED" | "PAID" | "RECEIVED";
  quantity: number;
  totalCost: number;
  requestedAt: string;
  rejectReason: string | null;
  catalogItem: { name: string };
  invoiceStatus: string;
};

const STEPS: { key: Row["status"]; label: string }[] = [
  { key: "PENDING_APPROVAL", label: "Enviado" },
  { key: "APPROVED", label: "Aprobado" },
  { key: "PAID", label: "Pagado" },
  { key: "RECEIVED", label: "Recibido" },
];

function stepIndex(status: Row["status"]) {
  if (status === "REJECTED") return -1;
  return STEPS.findIndex((s) => s.key === status);
}

function groupRows(rows: Row[]) {
  const map = new Map<string, Row[]>();
  for (const r of rows) {
    if (!map.has(r.groupId)) map.set(r.groupId, []);
    map.get(r.groupId)!.push(r);
  }
  return [...map.values()];
}

export function MyPurchaseRequests() {
  const [rows, setRows] = useState<Row[] | null>(null);

  useEffect(() => {
    fetch("/api/purchase-requests?view=mine").then((r) => (r.ok ? r.json() : [])).then(setRows).catch(() => setRows([]));
  }, []);

  if (!rows) return <div className="text-steel text-[13px]">Cargando…</div>;
  if (rows.length === 0) return <div className="border-[1.5px] border-dashed border-rule rounded-md p-8 text-center text-steel text-[13.5px]">Todavía no has enviado ninguna solicitud.</div>;

  const groups = groupRows(rows);

  return (
    <div className="flex flex-col gap-2.5">
      {groups.map((g) => {
        const groupId = g[0].groupId;
        const total = g.reduce((s, r) => s + r.totalCost, 0);
        const rejected = g[0].status === "REJECTED";
        // Si un grupo tiene varios productos, cada uno puede llegar por
        // separado (Inventario confirma producto por producto) — el avance
        // general muestra el paso MÁS ATRASADO de todos.
        const groupIdx = Math.min(...g.map((r) => stepIndex(r.status)));
        const namesDiffer = new Set(g.map((r) => r.status)).size > 1;
        return (
          <div key={groupId} className="bg-surface border border-rule rounded-md p-4">
            <div className="flex items-center justify-between gap-3 flex-wrap mb-2.5">
              <div>
                {g.map((r) => (
                  <div key={r.id} className="text-[13.5px] font-bold">
                    {r.catalogItem.name} · {r.quantity} un.
                    {namesDiffer && !rejected && (
                      <span className="ml-2 text-[10.5px] font-semibold text-steel">— {STEPS[stepIndex(r.status)]?.label ?? r.status}</span>
                    )}
                  </div>
                ))}
                <div className="text-[11.5px] text-steel">${total.toFixed(2)} · {new Date(g[0].requestedAt).toLocaleDateString("es-MX")}</div>
              </div>
            </div>
            {rejected ? (
              <div className="text-[12px] text-red">Rechazada{g[0].rejectReason ? ` — ${g[0].rejectReason}` : ""}</div>
            ) : (
              <div className="flex gap-1.5">
                {STEPS.map((s, i) => (
                  <div key={s.key} className={`flex-1 rounded-md py-1.5 text-center text-[10.5px] font-semibold border ${i <= groupIdx ? "border-green/45 text-green bg-green/10" : "border-rule text-steel bg-cloud"}`}>
                    {s.label}
                  </div>
                ))}
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}
