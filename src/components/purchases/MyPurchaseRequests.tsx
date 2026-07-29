"use client";

import { useEffect, useState } from "react";

type Row = {
  id: string;
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

export function MyPurchaseRequests() {
  const [rows, setRows] = useState<Row[] | null>(null);

  useEffect(() => {
    fetch("/api/purchase-requests?view=mine").then((r) => (r.ok ? r.json() : [])).then(setRows).catch(() => setRows([]));
  }, []);

  if (!rows) return <div className="text-steel text-[13px]">Cargando…</div>;
  if (rows.length === 0) return <div className="border-[1.5px] border-dashed border-rule rounded-md p-8 text-center text-steel text-[13.5px]">Todavía no has enviado ninguna solicitud.</div>;

  return (
    <div className="flex flex-col gap-2.5">
      {rows.map((r) => {
        const idx = stepIndex(r.status);
        return (
          <div key={r.id} className="bg-surface border border-rule rounded-md p-4">
            <div className="flex items-center justify-between gap-3 flex-wrap mb-2.5">
              <div>
                <div className="text-[13.5px] font-bold">{r.catalogItem.name} · {r.quantity} un.</div>
                <div className="text-[11.5px] text-steel">${r.totalCost.toFixed(2)} · {new Date(r.requestedAt).toLocaleDateString("es-MX")}</div>
              </div>
            </div>
            {r.status === "REJECTED" ? (
              <div className="text-[12px] text-red">Rechazada{r.rejectReason ? ` — ${r.rejectReason}` : ""}</div>
            ) : (
              <div className="flex gap-1.5">
                {STEPS.map((s, i) => (
                  <div key={s.key} className={`flex-1 rounded-md py-1.5 text-center text-[10.5px] font-semibold border ${i <= idx ? "border-green/45 text-green bg-green/10" : "border-rule text-steel bg-cloud"}`}>
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
