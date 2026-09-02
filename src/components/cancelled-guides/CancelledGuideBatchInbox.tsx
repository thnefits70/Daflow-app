"use client";

import { useEffect, useState } from "react";
import { Copy, Check } from "lucide-react";
import { CARRIER_LABELS, SOURCE_AREA_LABELS } from "@/lib/cancelledGuidesLabels";

type ReportDTO = {
  id: string;
  code: string;
  batchCode: string;
  sourceArea: keyof typeof SOURCE_AREA_LABELS;
  carrier: keyof typeof CARRIER_LABELS;
  reason: string;
  guideNumber: string;
  createdAt: string;
  submittedBy: { name: string } | null;
};

type Batch = {
  batchCode: string;
  sourceArea: keyof typeof SOURCE_AREA_LABELS;
  carrier: keyof typeof CARRIER_LABELS;
  reason: string;
  guideNumbers: string[];
  submittedByName: string;
};

function groupIntoBatches(reports: ReportDTO[]): Batch[] {
  const map = new Map<string, Batch>();
  for (const r of reports) {
    const existing = map.get(r.batchCode);
    if (existing) {
      existing.guideNumbers.push(r.guideNumber);
    } else {
      map.set(r.batchCode, {
        batchCode: r.batchCode,
        sourceArea: r.sourceArea,
        carrier: r.carrier,
        reason: r.reason,
        guideNumbers: [r.guideNumber],
        submittedByName: r.submittedBy?.name ?? "—",
      });
    }
  }
  return [...map.values()];
}

export function CancelledGuideBatchInbox() {
  const [reports, setReports] = useState<ReportDTO[] | null>(null);
  const [copiedCode, setCopiedCode] = useState<string | null>(null);
  const [managingCode, setManagingCode] = useState<string | null>(null);
  const [savingCode, setSavingCode] = useState<string | null>(null);
  const [error, setError] = useState("");

  function load() {
    fetch("/api/cancelled-guides/batches").then((r) => r.json()).then(setReports).catch(() => setReports([]));
  }
  useEffect(load, []);

  async function copy(batch: Batch) {
    try {
      await navigator.clipboard.writeText(batch.guideNumbers.join("\n"));
      setCopiedCode(batch.batchCode);
      setTimeout(() => setCopiedCode((c) => (c === batch.batchCode ? null : c)), 2000);
    } catch {
      setError("No se pudo copiar — copiá manualmente.");
    }
  }

  async function manage(batchCode: string) {
    setSavingCode(batchCode);
    setError("");
    try {
      const res = await fetch(`/api/cancelled-guides/batches/${batchCode}/manage`, { method: "POST" });
      const data = await res.json().catch(() => null);
      if (!res.ok) throw new Error(data?.error ?? "No se pudo confirmar.");
      setManagingCode(null);
      load();
    } catch (e) {
      setError(e instanceof Error ? e.message : "No se pudo confirmar.");
    } finally {
      setSavingCode(null);
    }
  }

  if (reports === null) return <div className="text-[13px] text-steel">Cargando…</div>;
  const batches = groupIntoBatches(reports);
  if (batches.length === 0) return <div className="text-[13px] text-steel">No hay lotes pendientes de gestionar.</div>;

  return (
    <div className="flex flex-col gap-3 max-w-lg">
      {error && <div className="text-red text-[11.5px]">{error}</div>}
      {batches.map((b) => (
        <div key={b.batchCode} className="bg-surface border border-rule rounded-md p-3.5">
          <div className="flex items-center gap-2 mb-1 flex-wrap">
            <span className="font-mono text-[11px] font-bold text-teal">{b.batchCode}</span>
            <span className="text-[11px] font-semibold">{CARRIER_LABELS[b.carrier]}</span>
            <span className="text-[10.5px] text-steel">{b.guideNumbers.length} guía{b.guideNumbers.length === 1 ? "" : "s"}</span>
          </div>
          <div className="text-[11px] text-steel mb-2">{SOURCE_AREA_LABELS[b.sourceArea]} · {b.reason} · subido por {b.submittedByName}</div>

          <div className="bg-cloud rounded-md p-2 mb-2.5 max-h-32 overflow-y-auto">
            {b.guideNumbers.map((g) => (
              <div key={g} className="font-mono text-[11.5px]">{g}</div>
            ))}
          </div>

          <div className="flex gap-2">
            <button type="button" className="flex-1 flex items-center justify-center gap-1.5 rounded border border-rule px-2.5 py-1.5 text-[11.5px] font-semibold cursor-pointer" onClick={() => copy(b)}>
              {copiedCode === b.batchCode ? <><Check size={13} className="text-green" /> Copiado</> : <><Copy size={13} /> Copiar guías</>}
            </button>
            {managingCode === b.batchCode ? (
              <button type="button" disabled={savingCode === b.batchCode} className="flex-1 rounded border border-teal bg-teal px-2.5 py-1.5 text-[11.5px] font-bold text-navy cursor-pointer disabled:opacity-60" onClick={() => manage(b.batchCode)}>
                {savingCode === b.batchCode ? "Confirmando…" : "Sí, ya gestioné con Dropi"}
              </button>
            ) : (
              <button type="button" className="flex-1 rounded border border-teal text-teal px-2.5 py-1.5 text-[11.5px] font-bold cursor-pointer" onClick={() => setManagingCode(b.batchCode)}>
                Confirmar gestión
              </button>
            )}
          </div>
        </div>
      ))}
    </div>
  );
}
