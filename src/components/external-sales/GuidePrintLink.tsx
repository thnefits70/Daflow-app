"use client";

import { useState } from "react";
import { CheckCircle2, Printer } from "lucide-react";
import { formatDateTime } from "@/lib/formatDateTime";

// Pedido de Yair 2026-09-30: después de tocar "Ver / imprimir guía" la venta
// muestra "Ya impreso" (quién y cuándo), sin quitar la opción de reimprimir.
// La marca se guarda en la base (guidePrintedAt), así se ve igual desde la
// computadora o el celular.
export function GuidePrintLink({
  saleId,
  printedAt,
  printedByName,
  className = "",
}: {
  saleId: string;
  printedAt: string | null;
  printedByName: string | null;
  className?: string;
}) {
  const [printed, setPrinted] = useState<{ at: string; by: string | null } | null>(
    printedAt ? { at: printedAt, by: printedByName } : null
  );

  function markPrinted() {
    setPrinted((p) => ({ at: new Date().toISOString(), by: p?.by ?? null }));
    fetch(`/api/external-sales/${saleId}/guide-printed`, { method: "POST" })
      .then((r) => (r.ok ? r.json() : null))
      .then((d: { guidePrintedAt: string; guidePrintedBy: { name: string } | null } | null) => {
        if (d) setPrinted({ at: d.guidePrintedAt, by: d.guidePrintedBy?.name ?? null });
      })
      .catch(() => {});
  }

  return (
    <div className={`flex flex-wrap items-center gap-x-2.5 gap-y-1 ${className}`}>
      {printed && (
        <span
          className="inline-flex items-center gap-1 text-[10.5px] font-semibold text-green bg-green/10 border border-green/30 rounded-full px-2 py-0.5"
          title={`${formatDateTime(printed.at)}${printed.by ? ` · ${printed.by}` : ""}`}
        >
          <CheckCircle2 size={12} /> Ya impreso
        </span>
      )}
      <a
        href={`/ventas-externas/${saleId}/guia`}
        target="_blank"
        rel="noreferrer"
        onClick={markPrinted}
        className="inline-flex items-center gap-1.5 text-[10.5px] font-semibold text-blue underline"
      >
        <Printer size={12} /> {printed ? "Volver a imprimir" : "Ver / imprimir guía"}
      </a>
      {printed && (
        <span className="text-[10px] text-steel">
          {formatDateTime(printed.at)}
          {printed.by ? ` · ${printed.by}` : ""}
        </span>
      )}
    </div>
  );
}
