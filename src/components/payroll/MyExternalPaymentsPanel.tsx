"use client";

import { useEffect, useState } from "react";
import { FileText } from "lucide-react";
import { ProofPreview } from "@/components/shared/ProofPreview";
import { formatDateTime } from "@/lib/formatDateTime";

const MONTHS = [
  "Enero", "Febrero", "Marzo", "Abril", "Mayo", "Junio",
  "Julio", "Agosto", "Septiembre", "Octubre", "Noviembre", "Diciembre",
];

function monthLabel(month: string) {
  const [y, m] = month.split("-");
  return `${MONTHS[Number(m) - 1]} ${y}`;
}

type Payment = {
  id: string;
  month: string;
  amount: number;
  receiptUrl: string;
  receiptFileName: string;
  invoiceUrl: string | null;
  invoiceFileName: string | null;
  invoiceNumber: string | null;
  updatedAt: string;
};

// Confirmado 2026-09-09: pedido explícito del usuario — quien está en modo
// de pago externo (PayrollProfile.externalPaymentMode) no factura ni
// siempre, pero SÍ quiere poder ver que efectivamente se le pagó, con el
// comprobante real. Mismo espíritu que MonthlyLegalRolePanel (ver el propio
// rol), pero para este grupo aparte.
export function MyExternalPaymentsPanel() {
  const [payments, setPayments] = useState<Payment[] | null>(null);

  useEffect(() => {
    fetch("/api/external-payments")
      .then((r) => (r.ok ? r.json() : null))
      .then((data) => setPayments(data?.payments ?? []));
  }, []);

  return (
    <div>
      <div className="font-semibold text-[13.5px] mb-1.5">Mis pagos</div>
      <div className="text-[11.5px] text-steel mb-3">
        Acá ves el comprobante de cada pago que se te hizo.
      </div>

      {payments === null && <div className="text-steel text-[13px]">Cargando…</div>}

      {payments?.length === 0 && (
        <div className="border-[1.5px] border-dashed border-rule rounded-md p-8.5 text-center text-steel text-[13.5px]">
          Todavía no hay ningún pago registrado.
        </div>
      )}

      {payments?.map((p) => (
        <div key={p.id} className="bg-surface border border-rule rounded p-3.5 mb-2.5">
          <div className="flex items-center justify-between gap-3 flex-wrap">
            <div className="flex items-center gap-2 font-semibold text-[13.5px]">
              <FileText size={14} className="text-steel" /> {monthLabel(p.month)}
            </div>
            <span className="text-[11.5px] font-semibold text-green">${p.amount.toFixed(2)}</span>
            <span className="font-mono text-[10.5px] text-steel">{formatDateTime(p.updatedAt)}</span>
          </div>
          <div className="flex items-center gap-4 flex-wrap mt-2.5">
            <div>
              <div className="text-[10px] font-semibold uppercase tracking-wide text-steel mb-1">Comprobante</div>
              <ProofPreview url={p.receiptUrl} filename={p.receiptFileName} size={48} />
            </div>
            {p.invoiceUrl && (
              <div>
                <div className="text-[10px] font-semibold uppercase tracking-wide text-steel mb-1">
                  Factura {p.invoiceNumber ? `(N° ${p.invoiceNumber})` : ""}
                </div>
                <ProofPreview url={p.invoiceUrl} filename={p.invoiceFileName ?? undefined} size={48} />
              </div>
            )}
          </div>
        </div>
      ))}
    </div>
  );
}
