"use client";

import { useEffect, useState } from "react";
import { X } from "lucide-react";
import { ProductMatchPicker, type MatchCatalogItem, type ProductMatchResult } from "@/components/merchandise-reentry/ProductMatchPicker";
import { CARRIER_LABELS, SOURCE_AREA_LABELS } from "@/lib/cancelledGuidesLabels";
import { CatalogCode } from "@/components/shared/CatalogCode";

type ReportDTO = {
  id: string;
  code: string;
  batchCode: string;
  sourceArea: keyof typeof SOURCE_AREA_LABELS;
  carrier: keyof typeof CARRIER_LABELS;
  reason: string;
  guideNumber: string;
};

type Row = { selected: MatchCatalogItem | null; quantity: string };

async function postJson(url: string, body: unknown) {
  const res = await fetch(url, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
  const data = await res.json().catch(() => null);
  if (!res.ok) throw new Error(data?.error ?? "Ocurrió un error.");
  return data;
}

function GuideCard({ report, onSaved }: { report: ReportDTO; onSaved: () => void }) {
  const [rows, setRows] = useState<Row[]>([{ selected: null, quantity: "" }]);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  const validRows = rows.filter((r) => r.selected && Number(r.quantity) > 0);
  const canSave = validRows.length > 0 && !saving;

  async function save() {
    setSaving(true);
    setError("");
    try {
      await postJson(`/api/cancelled-guides/${report.id}/items`, {
        items: validRows.map((r) => ({ catalogItemId: r.selected!.id, quantity: Number(r.quantity) })),
      });
      onSaved();
    } catch (e) {
      setError(e instanceof Error ? e.message : "No se pudo guardar.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="bg-surface border border-rule rounded-md p-3.5">
      <div className="flex items-center gap-2 mb-1 flex-wrap">
        <span className="font-mono text-[11px] font-bold text-teal">{report.code}</span>
        <span className="text-[11px] text-steel">Guía {report.guideNumber} · {CARRIER_LABELS[report.carrier]}</span>
      </div>
      <div className="text-[11px] text-steel mb-2">{SOURCE_AREA_LABELS[report.sourceArea]} · {report.reason}</div>

      <div className="flex flex-col gap-1.5 mb-2">
        {rows.map((row, i) => (
          <div key={i} className="bg-cloud rounded-md p-2">
            <div className="flex items-center justify-between mb-1.5">
              <span className="text-[10.5px] font-semibold text-steel">Producto {i + 1}</span>
              {rows.length > 1 && (
                <button type="button" className="text-steel hover:text-red cursor-pointer" onClick={() => setRows((rs) => rs.filter((_, j) => j !== i))}>
                  <X size={12} />
                </button>
              )}
            </div>
            {row.selected ? (
              <div className="flex items-center gap-2.5 bg-green/10 border border-green/35 rounded-md p-2 mb-2">
                <div className="flex-1 min-w-0 text-[12px] font-semibold flex items-center gap-1.5">
                  <CatalogCode code={row.selected.justCode} />
                  <span className="truncate">{row.selected.name}</span>
                </div>
                <button type="button" className="text-[11px] font-semibold text-blue cursor-pointer" onClick={() => setRows((rs) => rs.map((r, j) => (j === i ? { ...r, selected: null } : r)))}>Cambiar</button>
              </div>
            ) : (
              <ProductMatchPicker
                referencePhotoUrl={null}
                onConfirm={(r: ProductMatchResult) => setRows((rs) => rs.map((row2, j) => (j === i ? { ...row2, selected: r } : row2)))}
              />
            )}
            <div className="flex items-center gap-2">
              <span className="text-[11px] text-steel">Cantidad</span>
              <input type="number" min={1} className="w-20 rounded border border-rule bg-surface px-2 py-1 text-[12px] font-bold" value={row.quantity} onChange={(e) => setRows((rs) => rs.map((r, j) => (j === i ? { ...r, quantity: e.target.value } : r)))} />
            </div>
          </div>
        ))}
      </div>
      <button type="button" className="text-[11.5px] font-semibold text-blue cursor-pointer mb-2" onClick={() => setRows((rs) => [...rs, { selected: null, quantity: "" }])}>
        + Agregar otro producto
      </button>

      {error && <div className="text-red text-[11px] mb-1.5">{error}</div>}
      <button type="button" disabled={!canSave} className="w-full rounded border border-teal bg-teal px-2.5 py-1.5 text-[11.5px] font-bold text-navy cursor-pointer disabled:opacity-40" onClick={save}>
        {saving ? "Guardando…" : "Guardar productos"}
      </button>
    </div>
  );
}

export function CancelledGuideItemAssignmentPanel() {
  const [reports, setReports] = useState<ReportDTO[] | null>(null);

  function load() {
    fetch("/api/cancelled-guides/pending-items").then((r) => r.json()).then(setReports).catch(() => setReports([]));
  }
  useEffect(load, []);

  if (reports === null) return <div className="text-[13px] text-steel">Cargando…</div>;
  if (reports.length === 0) return <div className="text-[13px] text-steel">No hay guías pendientes de cargar productos.</div>;

  return (
    <div className="flex flex-col gap-3 max-w-lg">
      {reports.map((r) => (
        <GuideCard key={r.id} report={r} onSaved={load} />
      ))}
    </div>
  );
}
