"use client";

import { useEffect, useState } from "react";
import { OUTFLOW_REASON_LABELS } from "@/lib/merchandiseOutflowLabels";
import { formatDateTime } from "@/lib/formatDateTime";
import { CatalogCode } from "@/components/shared/CatalogCode";

type ItemDTO = {
  id: string;
  declaredName: string;
  quantity: number;
  catalogItem: { name: string; justCode: string | null } | null;
  resolution: "SOLVED_ONSITE" | "WRITE_OFF" | "ESCALATED_TO_PURCHASES" | null;
  resolutionNote: string | null;
  resolvedBy: { name: string } | null;
};
type BatchDTO = {
  id: string;
  code: string;
  reason: keyof typeof OUTFLOW_REASON_LABELS;
  submittedAt: string;
  justWrittenOffAt: string | null;
  createdBy: { name: string } | null;
  justWrittenOffBy: { name: string } | null;
  items: ItemDTO[];
};

function itemName(item: ItemDTO) {
  return item.catalogItem?.name ?? item.declaredName;
}

export function HistoryList() {
  const [batches, setBatches] = useState<BatchDTO[] | null>(null);

  useEffect(() => {
    fetch("/api/merchandise-outflow/history")
      .then((r) => r.json())
      // Fix confirmado 2026-08-26: un 403 llega igual como JSON de error, no
      // como arreglo — sin este chequeo el componente crasheaba tratando de
      // iterar sobre un objeto en vez de mostrar un estado vacío.
      .then((data) => setBatches(Array.isArray(data) ? data : []))
      .catch(() => setBatches([]));
  }, []);

  if (batches === null) return <div className="text-[13px] text-steel">Cargando…</div>;
  if (batches.length === 0) return <div className="text-[13px] text-steel">Todavía no hay egresos registrados.</div>;

  return (
    <div className="flex flex-col gap-2.5 max-w-lg">
      {batches.map((batch) => (
        <div key={batch.id} className="bg-surface border border-rule rounded-md p-3.5">
          <div className="flex items-center gap-2 mb-2">
            <span className="font-mono text-[11px] font-bold text-teal">{batch.code}</span>
            <span className="text-[10px] font-semibold uppercase tracking-wide text-steel bg-cloud rounded-full px-2 py-0.5">{OUTFLOW_REASON_LABELS[batch.reason] ?? batch.reason}</span>
            {batch.justWrittenOffAt ? (
              <span className="font-mono text-[9.5px] font-bold uppercase text-green">Dado de baja</span>
            ) : (
              <span className="font-mono text-[9.5px] font-bold uppercase text-gold">Pendiente</span>
            )}
          </div>
          <div className="flex flex-col gap-1 mb-2">
            {batch.items.map((item) => (
              <div key={item.id} className="text-[12.5px] flex items-center justify-between gap-2">
                <span className="flex items-center gap-1.5 min-w-0">
                  {item.catalogItem && <CatalogCode code={item.catalogItem.justCode} />}
                  <span className="truncate">{itemName(item)}</span>
                </span>
                <span className="font-mono text-[11px] text-steel shrink-0">{item.quantity} un.</span>
              </div>
            ))}
          </div>
          <div className="text-[10.5px] text-steel">
            Capturado por {batch.createdBy?.name ?? "—"} · {formatDateTime(batch.submittedAt)}
            {batch.justWrittenOffAt && batch.justWrittenOffBy && <> · Dado de baja por {batch.justWrittenOffBy.name} · {formatDateTime(batch.justWrittenOffAt)}</>}
          </div>
        </div>
      ))}
    </div>
  );
}
