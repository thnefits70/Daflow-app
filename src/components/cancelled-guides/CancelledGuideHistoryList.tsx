"use client";

import { useEffect, useState } from "react";
import { CARRIER_LABELS, SOURCE_AREA_LABELS } from "@/lib/cancelledGuidesLabels";

type ReportDTO = {
  id: string;
  code: string;
  guideNumber: string;
  carrier: keyof typeof CARRIER_LABELS;
  sourceArea: keyof typeof SOURCE_AREA_LABELS;
  reason: string;
  reallyCancelled: boolean | null;
  reingresadoAt: string | null;
  createdAt: string;
  submittedBy: { name: string } | null;
  items: { id: string; declaredName: string; quantity: number; catalogItem: { name: string } | null }[];
};

function statusChip(r: ReportDTO): { text: string; color: string } {
  if (r.reallyCancelled === null) return { text: "Pendiente de corte", color: "text-gold" };
  if (r.reallyCancelled === false) return { text: "Se despachó igual", color: "text-steel" };
  if (r.reingresadoAt) return { text: "Reingresada a Just", color: "text-green" };
  return { text: "Confirmada — falta reingresar", color: "text-blue" };
}

export function CancelledGuideHistoryList() {
  const [reports, setReports] = useState<ReportDTO[] | null>(null);

  useEffect(() => {
    fetch("/api/cancelled-guides").then((r) => r.json()).then(setReports).catch(() => setReports([]));
  }, []);

  if (reports === null) return <div className="text-[13px] text-steel">Cargando…</div>;
  if (reports.length === 0) return <div className="text-[13px] text-steel">Todavía no hay guías canceladas registradas.</div>;

  return (
    <div className="flex flex-col gap-2 max-w-lg">
      {reports.map((r) => {
        const status = statusChip(r);
        return (
          <div key={r.id} className="bg-surface border border-rule rounded-md p-3">
            <div className="flex items-center gap-2 mb-1 flex-wrap">
              <span className="font-mono text-[11px] font-bold text-teal">{r.code}</span>
              <span className="text-[11px] text-steel">Guía {r.guideNumber} · {CARRIER_LABELS[r.carrier]}</span>
              <span className={`font-mono text-[9.5px] font-bold uppercase ${status.color}`}>{status.text}</span>
            </div>
            <div className="text-[11px] text-steel mb-1">{SOURCE_AREA_LABELS[r.sourceArea]} · {r.reason}</div>
            <div className="flex flex-col gap-0.5 mb-1">
              {r.items.map((it) => (
                <div key={it.id} className="text-[12px]">{it.catalogItem?.name ?? it.declaredName} — {it.quantity} un.</div>
              ))}
            </div>
            <div className="text-[10.5px] text-steel">{r.submittedBy?.name ?? "—"} · {new Date(r.createdAt).toLocaleDateString("es-EC", { day: "2-digit", month: "short", year: "numeric" })}</div>
          </div>
        );
      })}
    </div>
  );
}
