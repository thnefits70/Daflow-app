"use client";

import { useEffect, useState } from "react";
import { Lock, ChevronDown, ChevronUp } from "lucide-react";

type ItemDTO = {
  id: string;
  catalogItem: { name: string } | null;
  correctedName: string | null;
  declaredName: string | null;
  goodQty: number;
  damagedQty: number;
  createdAt: string;
  approvedBy: { name: string } | null;
  justUploadedAt: string | null;
  justUploadedBy: { name: string } | null;
  writeOffBy: { name: string } | null;
};

type BatchDTO = {
  id: string;
  code: string;
  createdBy: { name: string } | null;
  submittedAt: string;
  danielApprovedAt: string | null;
  closedAt: string | null;
  items: ItemDTO[];
};

function itemName(item: ItemDTO) {
  return item.correctedName ?? item.catalogItem?.name ?? item.declaredName ?? "Producto sin nombre";
}

function fmt(iso: string) {
  return new Date(iso).toLocaleString("es-EC", { day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit" });
}

export function HistoryList() {
  const [batches, setBatches] = useState<BatchDTO[]>([]);
  const [loading, setLoading] = useState(true);
  const [expanded, setExpanded] = useState<string | null>(null);

  useEffect(() => {
    fetch("/api/merchandise-reentry/batches/history")
      .then((r) => r.json())
      .then((data) => setBatches(data ?? []))
      .finally(() => setLoading(false));
  }, []);

  if (loading) return <div className="text-[13px] text-steel">Cargando…</div>;
  if (batches.length === 0) return <div className="text-[12.5px] text-steel border-[1.5px] border-dashed border-rule rounded-md p-6 text-center">Todavía no hay lotes enviados.</div>;

  return (
    <div className="flex flex-col gap-2.5 max-w-2xl">
      {batches.map((b) => {
        const isOpen = expanded === b.id;
        const closerName =
          b.items.find((i) => i.justUploadedBy || i.writeOffBy)?.justUploadedBy?.name ??
          b.items.find((i) => i.justUploadedBy || i.writeOffBy)?.writeOffBy?.name ??
          "Finanzas (admin)";

        return (
          <div key={b.id} className="bg-surface border border-rule rounded-md p-3.5">
            <div className="flex items-center justify-between gap-2 mb-2.5 flex-wrap">
              <div className="flex items-center gap-2 min-w-0">
                <span className="font-mono text-[12px] font-bold text-teal shrink-0">{b.code}</span>
                <button
                  type="button"
                  onClick={() => setExpanded(isOpen ? null : b.id)}
                  className="flex items-center gap-1 text-[11.5px] text-steel hover:text-ink cursor-pointer shrink-0"
                >
                  {b.items.length} producto{b.items.length === 1 ? "" : "s"}
                  {isOpen ? <ChevronUp size={12} /> : <ChevronDown size={12} />}
                </button>
              </div>
              <div className="flex items-center gap-1.5 shrink-0">
                <span
                  className={`font-mono text-[9.5px] font-bold rounded-full px-2 py-0.5 whitespace-nowrap border ${
                    b.closedAt ? "text-green bg-green/15 border-green/40" : "text-steel bg-cloud border-rule"
                  }`}
                >
                  {b.closedAt ? "CERRADO" : "PENDIENTE DE CIERRE"}
                </span>
                <span className="font-mono text-[9.5px] font-bold text-steel bg-cloud border border-rule rounded-full px-2 py-0.5 flex items-center gap-1 whitespace-nowrap">
                  <Lock size={9} /> SOLO LECTURA
                </span>
              </div>
            </div>

            {isOpen && (
              <div className="flex flex-col gap-1 mb-2.5 pb-2.5 border-b border-rule">
                {b.items.map((i) => (
                  <div key={i.id} className="flex flex-wrap items-center gap-x-2 gap-y-0.5 text-[11px] text-steel bg-cloud border border-rule rounded px-1.5 py-1">
                    <span className="font-semibold text-ink">{itemName(i)}</span>
                    <span>· registrado en DAFLOW {fmt(i.createdAt)}</span>
                    {i.justUploadedAt && (
                      <span className="text-teal font-semibold">· subido a Just {fmt(i.justUploadedAt)}</span>
                    )}
                  </div>
                ))}
              </div>
            )}

            <div className="flex flex-col gap-1 text-[12px]">
              <div>
                <b>Capturado</b> {b.createdBy?.name ?? "—"} · {fmt(b.submittedAt)}
              </div>
              <div className={b.danielApprovedAt ? "" : "text-steel"}>
                <b>Aprobado</b> {b.danielApprovedAt ? (b.items.find((i) => i.approvedBy)?.approvedBy?.name ?? "Inventario (admin)") : "—"} · {b.danielApprovedAt ? fmt(b.danielApprovedAt) : "pendiente"}
              </div>
              <div className={b.closedAt ? "" : "text-steel"}>
                <b>Cerrado</b> {b.closedAt ? closerName : "—"} · {b.closedAt ? fmt(b.closedAt) : "pendiente"}
              </div>
            </div>
          </div>
        );
      })}
    </div>
  );
}
