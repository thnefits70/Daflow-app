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

type CarrierGroup = { carrier: keyof typeof CARRIER_LABELS; guideNumbers: string[] };
type Batch = {
  batchCode: string;
  sourceArea: keyof typeof SOURCE_AREA_LABELS;
  reason: string;
  submittedByName: string;
  guideCount: number;
  carrierGroups: CarrierGroup[];
};

// Un lote es TODA la tanda que alguien confirmó junta — puede traer varias
// transportadoras adentro (pedido explícito de Yair 2026-09-03), agrupadas
// acá solo para que copiar/pegar en Dropi sea por transportadora.
function groupIntoBatches(reports: ReportDTO[]): Batch[] {
  const map = new Map<string, Batch>();
  for (const r of reports) {
    let batch = map.get(r.batchCode);
    if (!batch) {
      batch = { batchCode: r.batchCode, sourceArea: r.sourceArea, reason: r.reason, submittedByName: r.submittedBy?.name ?? "—", guideCount: 0, carrierGroups: [] };
      map.set(r.batchCode, batch);
    }
    batch.guideCount += 1;
    let group = batch.carrierGroups.find((g) => g.carrier === r.carrier);
    if (!group) {
      group = { carrier: r.carrier, guideNumbers: [] };
      batch.carrierGroups.push(group);
    }
    group.guideNumbers.push(r.guideNumber);
  }
  return [...map.values()];
}

export function CancelledGuideBatchInbox() {
  const [reports, setReports] = useState<ReportDTO[] | null>(null);
  const [copiedKey, setCopiedKey] = useState<string | null>(null);
  const [managingCode, setManagingCode] = useState<string | null>(null);
  const [savingCode, setSavingCode] = useState<string | null>(null);
  const [error, setError] = useState("");

  function load() {
    fetch("/api/cancelled-guides/batches").then((r) => r.json()).then(setReports).catch(() => setReports([]));
  }
  useEffect(load, []);

  async function copy(key: string, guideNumbers: string[]) {
    try {
      await navigator.clipboard.writeText(guideNumbers.join("\n"));
      setCopiedKey(key);
      setTimeout(() => setCopiedKey((c) => (c === key ? null : c)), 2000);
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
            <span className="text-[10.5px] text-steel">{b.guideCount} guía{b.guideCount === 1 ? "" : "s"}</span>
          </div>
          <div className="text-[11px] text-steel mb-2.5">{SOURCE_AREA_LABELS[b.sourceArea]} · {b.reason} · subido por {b.submittedByName}</div>

          <div className="flex flex-col gap-2 mb-2.5">
            {b.carrierGroups.map((g) => {
              const copyKey = `${b.batchCode}:${g.carrier}`;
              return (
                <div key={g.carrier} className="bg-cloud rounded-md p-2.5">
                  <div className="flex items-center justify-between mb-1.5">
                    <span className="text-[11.5px] font-semibold">{CARRIER_LABELS[g.carrier]}</span>
                    <button type="button" className="flex items-center gap-1 text-[10.5px] font-semibold text-blue cursor-pointer" onClick={() => copy(copyKey, g.guideNumbers)}>
                      {copiedKey === copyKey ? <><Check size={12} className="text-green" /> Copiado</> : <><Copy size={12} /> Copiar</>}
                    </button>
                  </div>
                  <div className="max-h-28 overflow-y-auto">
                    {g.guideNumbers.map((num) => (
                      <div key={num} className="font-mono text-[11.5px]">{num}</div>
                    ))}
                  </div>
                </div>
              );
            })}
          </div>

          {managingCode === b.batchCode ? (
            <button type="button" disabled={savingCode === b.batchCode} className="w-full rounded border border-teal bg-teal px-2.5 py-1.5 text-[11.5px] font-bold text-navy cursor-pointer disabled:opacity-60" onClick={() => manage(b.batchCode)}>
              {savingCode === b.batchCode ? "Confirmando…" : "Sí, ya gestioné todo este lote con Dropi"}
            </button>
          ) : (
            <button type="button" className="w-full rounded border border-teal text-teal px-2.5 py-1.5 text-[11.5px] font-bold cursor-pointer" onClick={() => setManagingCode(b.batchCode)}>
              Confirmar gestión del lote completo
            </button>
          )}
        </div>
      ))}
    </div>
  );
}
