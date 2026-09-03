"use client";

import { useEffect, useState } from "react";
import { CARRIER_LABELS, SOURCE_AREA_LABELS } from "@/lib/cancelledGuidesLabels";
import { formatDateTime } from "@/lib/formatDateTime";
import { CatalogCode } from "@/components/shared/CatalogCode";

type ReportDTO = {
  id: string;
  code: string;
  batchCode: string | null;
  guideNumber: string;
  carrier: keyof typeof CARRIER_LABELS;
  sourceArea: keyof typeof SOURCE_AREA_LABELS;
  reason: string;
  reallyCancelled: boolean | null;
  batchManagedAt: string | null;
  itemsAssignedAt: string | null;
  reingresadoAt: string | null;
  createdAt: string;
  submittedBy: { name: string } | null;
  items: { id: string; declaredName: string; quantity: number; catalogItem: { name: string; justCode: string | null } | null }[];
};

// Bryan (batchManagedAt) y Heidy (itemsAssignedAt) trabajan en paralelo,
// cualquiera de los dos puede terminar primero — solo cuando los DOS están
// listos entra a la cola de Daniel.
function statusChip(r: ReportDTO): { text: string; color: string } {
  if (r.reingresadoAt) return { text: `Reingresada a Just · ${formatDateTime(r.reingresadoAt)}`, color: "text-green" };
  if (r.itemsAssignedAt && r.batchManagedAt) return { text: "Lista — falta reingresar", color: "text-blue" };
  if (r.itemsAssignedAt) return { text: "Con productos — falta que Bryan gestione con la transportadora", color: "text-gold" };
  if (r.batchManagedAt) return { text: "Gestionada con la transportadora — falta cargar productos", color: "text-gold" };
  // Reportes de antes del rediseño 2026-09-02 nunca tuvieron lote.
  if (!r.batchCode) {
    if (r.reallyCancelled === false) return { text: "Se despachó igual", color: "text-steel" };
    if (r.reallyCancelled === null) return { text: "Pendiente de corte (reporte antiguo)", color: "text-steel" };
  }
  return { text: "Pendiente de gestionar y cargar productos", color: "text-gold" };
}

type Group = { batchCode: string | null; carrier: keyof typeof CARRIER_LABELS; reports: ReportDTO[] };

// Yair carga las guías por lote — un lote es una sola solicitud a una
// transportadora, aunque tenga varias guías adentro. El historial refleja
// eso: se agrupa por lote (y transportadora), no una tarjeta por guía.
// Reportes de antes del rediseño 2026-09-02 no tienen batchCode y quedan
// cada uno en su propio grupo.
function groupByBatch(reports: ReportDTO[]): Group[] {
  const groups: Group[] = [];
  const indexByBatch = new Map<string, number>();
  for (const r of reports) {
    if (r.batchCode) {
      const idx = indexByBatch.get(r.batchCode);
      if (idx !== undefined) {
        groups[idx].reports.push(r);
        continue;
      }
      indexByBatch.set(r.batchCode, groups.length);
      groups.push({ batchCode: r.batchCode, carrier: r.carrier, reports: [r] });
    } else {
      groups.push({ batchCode: null, carrier: r.carrier, reports: [r] });
    }
  }
  return groups;
}

export function CancelledGuideHistoryList() {
  const [reports, setReports] = useState<ReportDTO[] | null>(null);

  useEffect(() => {
    fetch("/api/cancelled-guides").then((r) => r.json()).then(setReports).catch(() => setReports([]));
  }, []);

  if (reports === null) return <div className="text-[13px] text-steel">Cargando…</div>;
  if (reports.length === 0) return <div className="text-[13px] text-steel">Todavía no hay guías canceladas registradas.</div>;

  const groups = groupByBatch(reports);

  return (
    <div className="flex flex-col gap-2.5 max-w-lg">
      {groups.map((g) => {
        const first = g.reports[0];
        return (
          <div key={g.batchCode ?? first.id} className="bg-surface border border-rule rounded-md p-3">
            <div className="flex items-center gap-2 mb-1.5 flex-wrap">
              {g.batchCode ? (
                <span className="font-mono text-[11px] font-bold text-teal">{g.batchCode}</span>
              ) : (
                <span className="font-mono text-[10px] text-steel">Sin lote (reporte antiguo)</span>
              )}
              <span className="text-[11px] font-semibold">{CARRIER_LABELS[g.carrier]}</span>
              <span className="text-[10.5px] text-steel">{g.reports.length} guía{g.reports.length === 1 ? "" : "s"}</span>
            </div>

            <div className="flex flex-col gap-2">
              {g.reports.map((r) => {
                const status = statusChip(r);
                return (
                  <div key={r.id} className="bg-cloud rounded-md p-2.5">
                    <div className="flex items-center gap-2 mb-1 flex-wrap">
                      <span className="font-mono text-[11px] font-bold text-teal">{r.code}</span>
                      <span className="text-[11px] text-steel">Guía {r.guideNumber}</span>
                      <span className={`font-mono text-[9.5px] font-bold uppercase ${status.color}`}>{status.text}</span>
                    </div>
                    <div className="text-[11px] text-steel mb-1">{SOURCE_AREA_LABELS[r.sourceArea]} · {r.reason}</div>
                    <div className="flex flex-col gap-0.5">
                      {r.items.map((it) => (
                        <div key={it.id} className="text-[12px] flex items-center gap-1.5">
                          {it.catalogItem && <CatalogCode code={it.catalogItem.justCode} />}
                          <span>{it.catalogItem?.name ?? it.declaredName} — {it.quantity} un.</span>
                        </div>
                      ))}
                    </div>
                  </div>
                );
              })}
            </div>

            <div className="text-[10.5px] text-steel mt-1.5">{first.submittedBy?.name ?? "—"} · {formatDateTime(first.createdAt)}</div>
          </div>
        );
      })}
    </div>
  );
}
