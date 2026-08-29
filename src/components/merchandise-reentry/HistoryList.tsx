"use client";

import { useEffect, useState } from "react";
import { Lock, ChevronDown, ChevronUp } from "lucide-react";
import { CatalogCode } from "@/components/shared/CatalogCode";

type ItemDTO = {
  id: string;
  catalogItem: { name: string; justCode: string | null } | null;
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
        const justUploaders = [...new Set(b.items.filter((i) => i.justUploadedBy).map((i) => i.justUploadedBy!.name))];
        const writeOffers = [...new Set(b.items.filter((i) => i.writeOffBy).map((i) => i.writeOffBy!.name))];
        let closedLabel = "Cerrado";
        let closedDetail = "Finanzas (admin)";
        if (justUploaders.length && writeOffers.length) {
          closedDetail = `subido a Just por ${justUploaders.join(", ")} y dado de baja por ${writeOffers.join(", ")}`;
        } else if (justUploaders.length) {
          closedLabel = "Cerrado y subido a Just";
          closedDetail = justUploaders.join(", ");
        } else if (writeOffers.length) {
          closedLabel = "Cerrado y dado de baja";
          closedDetail = writeOffers.join(", ");
        }

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
                    {i.catalogItem && <CatalogCode code={i.catalogItem.justCode} />}
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
                <b>{b.closedAt ? closedLabel : "Cerrado"}</b> {b.closedAt ? closedDetail : "—"} · {b.closedAt ? fmt(b.closedAt) : "pendiente"}
              </div>
            </div>
          </div>
        );
      })}
    </div>
  );
}
