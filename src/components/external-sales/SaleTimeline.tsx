"use client";

import { formatDateTime } from "@/lib/formatDateTime";

// Los mismos 8 pasos que ya arma ExternalSaleHistoryList para el Kanban de
// Historial (visible solo para quien puede ver TODAS las ventas). Este
// módulo lo comparte con la vista "Mis ventas" del asesor, que solo ve las
// propias — así ambos lados muestran exactamente la misma trazabilidad.
export type SaleTimelineDTO = {
  createdAt: string;
  advisor: { name: string } | null;
  reviewedAt: string | null;
  reviewedBy: { name: string } | null;
  paymentConfirmedAt: string | null;
  paymentConfirmedBy: { name: string } | null;
  invoiceUploadedAt: string | null;
  invoiceUploadedBy: { name: string } | null;
  prepReadyAt: string | null;
  prepReadyBy: { name: string } | null;
  packAssignedAt: string | null;
  packAssignedTo: { name: string } | null;
  deliveredAt: string | null;
  deliveredBy: { name: string } | null;
  nairobyClosedAt: string | null;
};

type Step = { label: string; at: string | null; by: { name: string } | null };

function step(label: string, at: string | null, by: { name: string } | null): Step {
  return { label, at, by };
}

export function saleSteps(s: SaleTimelineDTO): Step[] {
  return [
    step("Declarada", s.createdAt, s.advisor),
    step("Aprobada", s.reviewedAt, s.reviewedBy),
    step("Pago confirmado", s.paymentConfirmedAt, s.paymentConfirmedBy),
    step("Facturada", s.invoiceUploadedAt, s.invoiceUploadedBy),
    step("Agrupada", s.prepReadyAt, s.prepReadyBy),
    step("Embalaje asignado", s.packAssignedAt, s.packAssignedTo),
    step("Entregada", s.deliveredAt, s.deliveredBy),
    step("Cerrada", s.nairobyClosedAt, null),
  ];
}

export function TimelineSteps({ steps }: { steps: Step[] }) {
  const reached = steps.filter((st) => st.at);
  if (reached.length === 0) return null;
  return (
    <div className="text-[10.5px] text-steel flex flex-col gap-0.5">
      {reached.map((st) => (
        <div key={st.label}>
          {st.label}
          {st.by ? ` por ${st.by.name}` : ""} · {formatDateTime(st.at!)}
        </div>
      ))}
    </div>
  );
}
