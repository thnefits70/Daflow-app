"use client";

import { useEffect, useState } from "react";
import { Check } from "lucide-react";
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
  batchManagedBy: { name: string } | null;
  fulfillmentRemovedAt: string | null;
  fulfillmentRemovedBy: { name: string } | null;
  itemsAssignedAt: string | null;
  reingresadoAt: string | null;
  retainedAt: string | null;
  retainedBy: { name: string } | null;
  createdAt: string;
  submittedBy: { name: string } | null;
  items: { id: string; declaredName: string; quantity: number; catalogItem: { name: string; justCode: string | null } | null }[];
};

// Bryan (batchManagedAt), Yair (fulfillmentRemovedAt, solo después de
// Bryan) y Heidy (itemsAssignedAt) — los últimos dos corren en paralelo —
// cuando los TRES están listos vuelve sola a INVESTOCK (inventoryAutoFlows.ts).
function statusChip(r: ReportDTO): { text: string; color: string } {
  if (r.reingresadoAt) return { text: `Reingresada al inventario · ${formatDateTime(r.reingresadoAt)}`, color: "text-green" };
  if (r.itemsAssignedAt && r.batchManagedAt && r.fulfillmentRemovedAt) return { text: "Lista — reingresando al inventario", color: "text-blue" };
  const missing: string[] = [];
  if (!r.batchManagedAt) missing.push("que Bryan gestione con la transportadora");
  if (!r.fulfillmentRemovedAt) missing.push("que Daniel confirme la salida de Fulfillment");
  if (!r.itemsAssignedAt) missing.push("cargar productos");
  if (missing.length > 0 && (r.batchManagedAt || r.fulfillmentRemovedAt || r.itemsAssignedAt)) {
    return { text: `Falta ${missing.join(" y ")}`, color: "text-gold" };
  }
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

// Pedido de Daniel 2026-10-14: cuadrito a la derecha de cada guía — solo
// Daniel y Allan lo pueden marcar. Al confirmar queda el visto con quién la
// retuvo; quien la reportó recibe aviso y deja de sumar en Pedidos despachados.
function RetainBox({ report, canRetain, onRetained }: { report: ReportDTO; canRetain: boolean; onRetained: (r: Pick<ReportDTO, "retainedAt" | "retainedBy">) => void }) {
  const [asking, setAsking] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (report.retainedAt) {
    return (
      <div className="flex flex-col items-end gap-0.5 shrink-0 text-right">
        <span className="w-5 h-5 rounded border border-green bg-green/15 text-green flex items-center justify-center"><Check size={13} strokeWidth={3} /></span>
        <span className="text-[9.5px] text-green leading-tight">Retuvo {report.retainedBy?.name ?? "—"}</span>
        <span className="text-[9px] text-steel leading-tight">{formatDateTime(report.retainedAt)}</span>
      </div>
    );
  }
  if (!canRetain) return null;

  const confirm = async () => {
    setSaving(true);
    setError(null);
    const res = await fetch(`/api/cancelled-guides/${report.id}/retain`, { method: "POST" }).catch(() => null);
    const data = res ? await res.json().catch(() => null) : null;
    setSaving(false);
    if (!res?.ok) {
      setError(data?.error ?? "No se pudo guardar, intenta de nuevo.");
      return;
    }
    setAsking(false);
    onRetained({ retainedAt: data.retainedAt, retainedBy: data.retainedBy });
  };

  if (!asking) {
    return (
      <button type="button" title="Marcar como retenida" onClick={() => setAsking(true)} className="w-5 h-5 rounded border border-steel/60 hover:border-teal shrink-0 cursor-pointer" />
    );
  }
  return (
    <div className="flex flex-col items-end gap-1 shrink-0 max-w-[150px] text-right">
      <span className="text-[10.5px] font-semibold leading-tight">¿Confirmas que retuviste la guía?</span>
      <div className="flex gap-1.5">
        <button type="button" disabled={saving} onClick={() => setAsking(false)} className="text-[10.5px] px-2 py-0.5 rounded border border-rule text-steel cursor-pointer disabled:opacity-50">No</button>
        <button type="button" disabled={saving} onClick={confirm} className="text-[10.5px] px-2 py-0.5 rounded bg-teal text-white font-semibold cursor-pointer disabled:opacity-50">{saving ? "…" : "Sí"}</button>
      </div>
      {error && <span className="text-[9.5px] text-red leading-tight">{error}</span>}
    </div>
  );
}

export function CancelledGuideHistoryList() {
  const [reports, setReports] = useState<ReportDTO[] | null>(null);
  const [canRetain, setCanRetain] = useState(false);

  useEffect(() => {
    fetch("/api/cancelled-guides")
      .then((r) => r.json())
      .then((d: { reports: ReportDTO[]; canRetain: boolean }) => {
        setReports(d.reports ?? []);
        setCanRetain(!!d.canRetain);
      })
      .catch(() => setReports([]));
  }, []);

  const markRetained = (id: string, patch: Pick<ReportDTO, "retainedAt" | "retainedBy">) =>
    setReports((prev) => prev?.map((r) => (r.id === id ? { ...r, ...patch } : r)) ?? prev);

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
                  <div key={r.id} className="bg-cloud rounded-md p-2.5 flex gap-2">
                    <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 mb-1 flex-wrap">
                      <span className="font-mono text-[11px] font-bold text-teal">{r.code}</span>
                      <span className="text-[11px] text-steel">Guía {r.guideNumber}</span>
                      <span className={`font-mono text-[9.5px] font-bold uppercase ${status.color}`}>{status.text}</span>
                    </div>
                    <div className="text-[11px] text-steel mb-1">{SOURCE_AREA_LABELS[r.sourceArea]} · {r.reason}</div>
                    {(r.batchManagedAt || r.fulfillmentRemovedAt) && (
                      <div className="text-[10px] text-steel mb-1">
                        {r.batchManagedAt && <div>Aprobó {r.batchManagedBy?.name ?? "—"} · {formatDateTime(r.batchManagedAt)}</div>}
                        {r.fulfillmentRemovedAt && <div>Sacó de Fulfillment {r.fulfillmentRemovedBy?.name ?? "—"} · {formatDateTime(r.fulfillmentRemovedAt)}</div>}
                      </div>
                    )}
                    <div className="flex flex-col gap-0.5">
                      {r.items.map((it) => (
                        <div key={it.id} className="text-[12px] flex items-center gap-1.5">
                          {it.catalogItem && <CatalogCode code={it.catalogItem.justCode} />}
                          <span>{it.catalogItem?.name ?? it.declaredName} — {it.quantity} un.</span>
                        </div>
                      ))}
                    </div>
                    </div>
                    <RetainBox report={r} canRetain={canRetain} onRetained={(p) => markRetained(r.id, p)} />
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
