"use client";

import { useEffect, useState } from "react";
import { formatDateTime } from "@/lib/formatDateTime";
import { CatalogCode } from "@/components/shared/CatalogCode";

type SaleDTO = {
  id: string;
  code: string;
  declaredProductName: string;
  catalogItem: { name: string; justCode: string | null } | null;
  quantity: number;
  totalAmount: number;
  pickupPersonName: string;
  courierNote: string | null;
  reviewStatus: "PENDING" | "APPROVED" | "REJECTED";
  rejectionReason: string | null;
  paymentProofUrl: string | null;
  paymentProofName: string | null;
  paymentConfirmedAt: string | null;
  nairobyClosedAt: string | null;
  createdAt: string;
  advisor: { name: string } | null;
  dispatchAssignedTo: { name: string } | null;
  deliveredBy: { name: string } | null;
};

export function ExternalSaleHistoryList() {
  const [sales, setSales] = useState<SaleDTO[] | null>(null);

  useEffect(() => {
    fetch("/api/external-sales/history").then((r) => r.json()).then(setSales).catch(() => setSales([]));
  }, []);

  if (sales === null) return <div className="text-[13px] text-steel">Cargando…</div>;
  if (sales.length === 0) return <div className="text-[13px] text-steel">Todavía no hay ventas externas registradas.</div>;

  return (
    <div className="flex flex-col gap-2 max-w-lg">
      {sales.map((s) => (
        <div key={s.id} className="bg-surface border border-rule rounded-md p-3">
          <div className="flex items-center gap-2 mb-1">
            <span className="font-mono text-[11px] font-bold text-teal">{s.code}</span>
            <span className="text-[11px] text-steel">{s.advisor?.name ?? "—"}</span>
            {s.reviewStatus === "REJECTED" && <span className="font-mono text-[9.5px] font-bold uppercase text-red">Rechazada</span>}
            {s.reviewStatus === "PENDING" && <span className="font-mono text-[9.5px] font-bold uppercase text-gold">Pendiente</span>}
            {s.reviewStatus === "APPROVED" && (s.nairobyClosedAt ? <span className="font-mono text-[9.5px] font-bold uppercase text-green">Cerrada</span> : <span className="font-mono text-[9.5px] font-bold uppercase text-blue">En proceso</span>)}
          </div>
          <div className="text-[12.5px] font-semibold flex items-center gap-1.5 flex-wrap">
            {s.catalogItem && <CatalogCode code={s.catalogItem.justCode} />}
            <span>{s.catalogItem?.name ?? s.declaredProductName} — {s.quantity} un. · ${s.totalAmount.toFixed(2)}</span>
          </div>
          <div className="text-[10.5px] text-steel">Entrega a: {s.pickupPersonName}{s.courierNote ? ` · Transportadora: ${s.courierNote}` : ""}</div>
          {s.dispatchAssignedTo && <div className="text-[10.5px] text-steel">Despachó {s.dispatchAssignedTo.name}{s.deliveredBy ? ` · entregó ${s.deliveredBy.name}` : ""}</div>}
          {s.paymentProofUrl && (
            <div className="text-[10.5px]">
              <a href={s.paymentProofUrl} target="_blank" rel="noreferrer" className="font-semibold text-blue underline">
                Ver comprobante de pago{s.paymentProofName ? ` (${s.paymentProofName})` : ""}
              </a>
              {!s.paymentConfirmedAt && <span className="text-gold font-semibold"> · esperando confirmación</span>}
            </div>
          )}
          {s.nairobyClosedAt && <div className="text-[10.5px] text-green">Cerrada el {formatDateTime(s.nairobyClosedAt)}</div>}
          <div className="text-[10.5px] text-steel">{formatDateTime(s.createdAt)}</div>
        </div>
      ))}
    </div>
  );
}
