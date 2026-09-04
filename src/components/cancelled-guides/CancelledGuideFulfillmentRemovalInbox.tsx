"use client";

import { useEffect, useState } from "react";
import { Copy, Check } from "lucide-react";
import { CARRIER_LABELS, SOURCE_AREA_LABELS } from "@/lib/cancelledGuidesLabels";
import { formatDateTime } from "@/lib/formatDateTime";

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
  batchManagedAt: string;
  batchManagedBy: { name: string } | null;
};

type CarrierGroup = { carrier: keyof typeof CARRIER_LABELS; guideNumbers: string[] };
type Batch = {
  batchCode: string;
  sourceArea: keyof typeof SOURCE_AREA_LABELS;
  reason: string;
  submittedByName: string;
  guideCount: number;
  carrierGroups: CarrierGroup[];
  batchManagedAt: string;
  batchManagedByName: string;
};

// Mismo agrupamiento que CancelledGuideBatchInbox (Bryan) — acá Yair ve los
// lotes que Bryan YA gestionó y confirma que los sacó de Fulfillment.
function groupIntoBatches(reports: ReportDTO[]): Batch[] {
  const map = new Map<string, Batch>();
  for (const r of reports) {
    let batch = map.get(r.batchCode);
    if (!batch) {
      batch = {
        batchCode: r.batchCode,
        sourceArea: r.sourceArea,
        reason: r.reason,
        submittedByName: r.submittedBy?.name ?? "—",
        guideCount: 0,
        carrierGroups: [],
        batchManagedAt: r.batchManagedAt,
        batchManagedByName: r.batchManagedBy?.name ?? "—",
      };
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

// Agregado 2026-09-03, pedido explícito del usuario: Yair (líder FUL)
// confirma, lote por lote, que ya sacó del área de Fulfillment las guías
// que Bryan gestionó con la transportadora — para que no se despachen.
export function CancelledGuideFulfillmentRemovalInbox() {
  const [reports, setReports] = useState<ReportDTO[] | null>(null);
  const [copiedKey, setCopiedKey] = useState<string | null>(null);
  const [confirmingCode, setConfirmingCode] = useState<string | null>(null);
  const [savingCode, setSavingCode] = useState<string | null>(null);
  const [error, setError] = useState("");

  function load() {
    fetch("/api/cancelled-guides/batches/pending-fulfillment-removal").then((r) => r.json()).then(setReports).catch(() => setReports([]));
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

  async function confirm(batchCode: string) {
    setSavingCode(batchCode);
    setError("");
    try {
      const res = await fetch(`/api/cancelled-guides/batches/${batchCode}/confirm-removal`, { method: "POST" });
      const data = await res.json().catch(() => null);
      if (!res.ok) throw new Error(data?.error ?? "No se pudo confirmar.");
      setConfirmingCode(null);
      load();
    } catch (e) {
      setError(e instanceof Error ? e.message : "No se pudo confirmar.");
    } finally {
      setSavingCode(null);
    }
  }

  if (reports === null) return <div className="text-[13px] text-steel">Cargando…</div>;
  const batches = groupIntoBatches(reports);
  if (batches.length === 0) return <div className="text-[13px] text-steel">No hay lotes pendientes de sacar de Fulfillment.</div>;

  return (
    <div className="flex flex-col gap-3 max-w-lg">
      {error && <div className="text-red text-[11.5px]">{error}</div>}
      {batches.map((b) => (
        <div key={b.batchCode} className="bg-surface border border-rule rounded-md p-3.5">
          <div className="flex items-center gap-2 mb-1 flex-wrap">
            <span className="font-mono text-[11px] font-bold text-teal">{b.batchCode}</span>
            <span className="text-[10.5px] text-steel">{b.guideCount} guía{b.guideCount === 1 ? "" : "s"}</span>
          </div>
          <div className="text-[11px] text-steel mb-1">{SOURCE_AREA_LABELS[b.sourceArea]} · {b.reason} · subido por {b.submittedByName}</div>
          <div className="text-[11px] text-steel mb-2.5">Gestionado por {b.batchManagedByName} · {formatDateTime(b.batchManagedAt)}</div>

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

          {confirmingCode === b.batchCode ? (
            <button type="button" disabled={savingCode === b.batchCode} className="w-full rounded border border-teal bg-teal px-2.5 py-1.5 text-[11.5px] font-bold text-navy cursor-pointer disabled:opacity-60" onClick={() => confirm(b.batchCode)}>
              {savingCode === b.batchCode ? "Confirmando…" : "Sí, ya saqué estas guías de Fulfillment"}
            </button>
          ) : (
            <button type="button" className="w-full rounded border border-teal text-teal px-2.5 py-1.5 text-[11.5px] font-bold cursor-pointer" onClick={() => setConfirmingCode(b.batchCode)}>
              Confirmar salida de Fulfillment del lote completo
            </button>
          )}
        </div>
      ))}
    </div>
  );
}
