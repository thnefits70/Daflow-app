"use client";

import { useEffect, useState } from "react";
import { ChevronDown, ChevronUp } from "lucide-react";
import { formatDateTime } from "@/lib/formatDateTime";
import { CatalogCode } from "@/components/shared/CatalogCode";

type SaleItemDTO = {
  id: string;
  declaredProductName: string;
  catalogItem: { name: string; justCode: string | null } | null;
  quantity: number;
  unitPrice: number;
  totalAmount: number;
  rejectedAt: string | null;
  rejectionReason: string | null;
};
type SaleDTO = {
  id: string;
  code: string;
  items: SaleItemDTO[];
  totalAmount: number;
  pickupPersonName: string;
  courierNote: string | null;
  client: { name: string; idType: "RUC" | "CEDULA"; idNumber: string; phone: string; email: string | null; city: string | null; country: string | null } | null;
  isContraEntrega: boolean;
  reviewStatus: "PENDING" | "APPROVED" | "REJECTED";
  rejectionReason: string | null;
  paymentProofUrl: string | null;
  paymentProofName: string | null;
  paymentConfirmedAt: string | null;
  paymentConfirmedBy: { name: string } | null;
  invoiceUrl: string | null;
  invoiceUploadedAt: string | null;
  invoiceUploadedBy: { name: string } | null;
  nairobyClosedAt: string | null;
  createdAt: string;
  advisor: { name: string } | null;
  reviewedAt: string | null;
  reviewedBy: { name: string } | null;
  dispatchAssignedTo: { name: string } | null;
  prepReadyAt: string | null;
  prepReadyBy: { name: string } | null;
  packAssignedAt: string | null;
  packAssignedTo: { name: string } | null;
  deliveredAt: string | null;
  deliveredBy: { name: string } | null;
  deletedAt: string | null;
};

function Pill({ label, done }: { label: string; done: boolean }) {
  return (
    <span
      className={`text-[10.5px] font-bold uppercase tracking-wide rounded px-2 py-1 border ${
        done ? "bg-green/10 border-green/40 text-green" : "bg-cloud border-rule text-steel"
      }`}
    >
      {label}
    </span>
  );
}

function step(label: string, at: string | null, by: { name: string } | null) {
  return { label, at, by };
}

export function ExternalSaleHistoryList() {
  const [sales, setSales] = useState<SaleDTO[] | null>(null);
  const [expanded, setExpanded] = useState<string | null>(null);

  useEffect(() => {
    fetch("/api/external-sales/history").then((r) => r.json()).then(setSales).catch(() => setSales([]));
  }, []);

  if (sales === null) return <div className="text-[13px] text-steel">Cargando…</div>;
  if (sales.length === 0) return <div className="text-[13px] text-steel">Todavía no hay ventas externas registradas.</div>;

  return (
    <div className="flex flex-col gap-2 max-w-lg">
      {sales.map((s) => {
        const isOpen = expanded === s.id;
        const steps = [
          step("Declarada", s.createdAt, s.advisor),
          step("Aprobada", s.reviewedAt, s.reviewedBy),
          step("Pago confirmado", s.paymentConfirmedAt, s.paymentConfirmedBy),
          step("Facturada", s.invoiceUploadedAt, s.invoiceUploadedBy),
          step("Agrupada", s.prepReadyAt, s.prepReadyBy),
          step("Embalaje asignado", s.packAssignedAt, s.packAssignedTo),
          step("Entregada", s.deliveredAt, s.deliveredBy),
          step("Cerrada", s.nairobyClosedAt, null),
        ];

        return (
          <div key={s.id} className="bg-surface border border-rule rounded-md p-3">
            <div className="flex items-center gap-2 mb-1">
              <span className="font-mono text-[11px] font-bold text-teal">{s.code}</span>
              <span className="text-[11px] text-steel">{s.advisor?.name ?? "—"}</span>
              {s.isContraEntrega && <span className="font-mono text-[9px] font-bold uppercase text-blue">Contra entrega</span>}
              {s.deletedAt && <span className="font-mono text-[9.5px] font-bold uppercase text-red">Eliminada</span>}
              {!s.deletedAt && s.reviewStatus === "REJECTED" && <span className="font-mono text-[9.5px] font-bold uppercase text-red">Rechazada</span>}
              {!s.deletedAt && s.reviewStatus === "PENDING" && <span className="font-mono text-[9.5px] font-bold uppercase text-gold">Pendiente</span>}
              {!s.deletedAt && s.reviewStatus === "APPROVED" && (s.nairobyClosedAt ? <span className="font-mono text-[9.5px] font-bold uppercase text-green">Cerrada</span> : <span className="font-mono text-[9.5px] font-bold uppercase text-blue">En proceso</span>)}
            </div>
            {s.deletedAt && <div className="text-[11px] text-red mb-0.5">Eliminada por admin · {formatDateTime(s.deletedAt)}</div>}
            <div className="flex flex-col gap-0.5">
              {s.items.map((it) => (
                <div key={it.id} className="text-[12.5px] font-semibold flex items-center gap-1.5 flex-wrap">
                  {it.catalogItem && <CatalogCode code={it.catalogItem.justCode} />}
                  <span>{it.catalogItem?.name ?? it.declaredProductName} — {it.quantity} un. · ${it.totalAmount.toFixed(2)}</span>
                  {it.rejectedAt && <span className="font-mono text-[9px] font-bold uppercase text-red">Rechazado</span>}
                </div>
              ))}
            </div>
            <div className="text-[11px] font-bold">Total: ${s.totalAmount.toFixed(2)}</div>
            <div className="text-[10.5px] text-steel">{formatDateTime(s.createdAt)}</div>

            {s.reviewStatus !== "REJECTED" && (
              <button
                type="button"
                className="mt-2 flex items-center gap-1 text-[11px] font-semibold text-blue cursor-pointer"
                onClick={() => setExpanded(isOpen ? null : s.id)}
              >
                {isOpen ? <ChevronUp size={13} /> : <ChevronDown size={13} />} {isOpen ? "Ocultar trazabilidad" : "Ver trazabilidad completa"}
              </button>
            )}

            {isOpen && (
              <div className="mt-2.5 border-t border-rule pt-2.5 flex flex-col gap-2">
                <div className="flex flex-wrap gap-1.5">
                  {steps.map((st) => (
                    <Pill key={st.label} label={st.label} done={!!st.at} />
                  ))}
                </div>
                <div className="text-[10.5px] text-steel flex flex-col gap-0.5">
                  {steps.filter((st) => st.at).map((st) => (
                    <div key={st.label}>
                      {st.label}{st.by ? ` por ${st.by.name}` : ""} · {formatDateTime(st.at!)}
                    </div>
                  ))}
                </div>
                <div className="text-[10.5px] text-steel">Entrega a: {s.pickupPersonName}{s.courierNote ? ` · Transportadora: ${s.courierNote}` : ""}</div>
                {s.client && (
                  <div className="text-[10.5px] text-steel">
                    Cliente: {s.client.name} · {s.client.idType === "RUC" ? "RUC" : "Cédula"}: {s.client.idNumber} · Cel: {s.client.phone}
                    {s.client.email ? ` · Correo: ${s.client.email}` : ""}
                    {(s.client.city || s.client.country) ? ` · ${[s.client.city, s.client.country].filter(Boolean).join(", ")}` : ""}
                  </div>
                )}
                {s.paymentProofUrl && (
                  <a href={s.paymentProofUrl} target="_blank" rel="noreferrer" className="text-[10.5px] font-semibold text-blue underline">
                    Ver comprobante de pago{s.paymentProofName ? ` (${s.paymentProofName})` : ""}
                  </a>
                )}
                {s.invoiceUrl && (
                  <a href={s.invoiceUrl} target="_blank" rel="noreferrer" className="text-[10.5px] font-semibold text-blue underline">
                    Ver factura
                  </a>
                )}
              </div>
            )}

            {s.reviewStatus === "REJECTED" && s.rejectionReason && <div className="text-[11.5px] text-red mt-1">{s.rejectionReason}</div>}
          </div>
        );
      })}
    </div>
  );
}
