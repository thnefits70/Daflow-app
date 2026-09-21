"use client";

import { Check } from "lucide-react";
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

// Ruta vertical del pedido (pedido explícito de Marcos 2026-09-21, misma idea
// que el tablero por columnas de Historial pero para UN pedido): muestra los
// 8 pasos siempre, no solo los ya cumplidos, para que se vea de un vistazo
// dónde va y qué falta. "Actual" es el primer paso sin cumplir después del
// último cumplido en el orden de la lista — en contra entrega puede haber
// pasos cumplidos fuera de orden (ver saleColumn en ExternalSaleHistoryList),
// así que un paso saltado simplemente queda gris, sin marcarse como actual.
export function TimelineSteps({ steps }: { steps: Step[] }) {
  const lastDoneIndex = steps.reduce((acc, st, i) => (st.at ? i : acc), -1);
  return (
    <div className="flex flex-col">
      {steps.map((st, i) => {
        const done = !!st.at;
        const isCurrent = !done && i === lastDoneIndex + 1;
        const isLast = i === steps.length - 1;
        return (
          <div key={st.label} className="flex gap-2.5">
            <div className="flex flex-col items-center">
              <div
                className={`flex items-center justify-center w-5 h-5 rounded-full border-2 shrink-0 ${
                  done ? "bg-teal border-teal" : isCurrent ? "border-gold bg-cloud" : "border-rule bg-cloud"
                }`}
              >
                {done && <Check size={12} className="text-navy" strokeWidth={3} />}
              </div>
              {!isLast && <div className={`w-0.5 flex-1 min-h-[14px] ${done ? "bg-teal" : "bg-rule"}`} />}
            </div>
            <div className={isLast ? "pb-0" : "pb-2.5"}>
              <div className={`text-[11.5px] font-semibold ${done ? "text-ink" : isCurrent ? "text-gold" : "text-steel"}`}>{st.label}</div>
              {done ? (
                <div className="text-[10.5px] text-steel">
                  {st.by ? `${st.by.name} · ` : ""}
                  {formatDateTime(st.at!)}
                </div>
              ) : isCurrent ? (
                <div className="text-[10.5px] text-gold">En curso</div>
              ) : null}
            </div>
          </div>
        );
      })}
    </div>
  );
}
