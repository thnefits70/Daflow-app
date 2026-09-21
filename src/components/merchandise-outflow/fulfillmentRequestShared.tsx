"use client";

import { useState } from "react";
import { CheckCircle2, ChevronDown, ChevronUp, Package } from "lucide-react";

export type CompiledLine = { catalogItemId: string; name: string; photos: string[]; quantity: number };
export type CompiledBatch = { id: string; source: string; requestedAt: string; requestedByName: string; totalRows: number; skippedCount: number; lines: CompiledLine[] };
export type BatchListItem = { id: string; source: string; requestedAt: string; requestedByName: string; totalRows: number; skippedCount: number; lineCount: number };

export function fmt(iso: string) {
  return new Date(iso).toLocaleString("es-EC", { day: "2-digit", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit" });
}

export function sourceLabel(source: string) {
  return source === "ROCKET" ? "Rocket" : "Dropi";
}

export function CompiledResult({ batch }: { batch: CompiledBatch }) {
  return (
    <div className="bg-surface border border-rule rounded-md p-4 mb-5">
      <div className="flex items-center gap-1.5 text-teal text-[13px] font-bold mb-1">
        <CheckCircle2 size={15} /> Compendiado listo — {sourceLabel(batch.source)}
      </div>
      <div className="text-[11.5px] text-steel mb-3">
        {fmt(batch.requestedAt)} · subido por {batch.requestedByName} · {batch.totalRows} filas del archivo
        {batch.skippedCount > 0 ? `, ${batch.skippedCount} ignoradas` : ""} → {batch.lines.length} productos reales distintos.
      </div>
      <div className="flex flex-col gap-1.5 max-h-96 overflow-y-auto">
        {batch.lines.map((l) => (
          <div key={l.catalogItemId} className="flex items-center gap-2.5 bg-cloud rounded-md px-3 py-2">
            {l.photos[0] ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={l.photos[0]} alt="" className="w-7 h-7 object-cover rounded border border-rule shrink-0" />
            ) : (
              <div className="w-7 h-7 rounded border border-dashed border-rule shrink-0 flex items-center justify-center text-steel">
                <Package size={12} />
              </div>
            )}
            <span className="text-[12.5px] flex-1 min-w-0 truncate">{l.name}</span>
            <span className="font-mono text-[13px] font-bold text-teal shrink-0">{l.quantity}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

export function FulfillmentHistoryList({ history, onView }: { history: BatchListItem[]; onView: (id: string) => void }) {
  const [show, setShow] = useState(false);
  if (history.length === 0) return null;
  return (
    <div>
      <button type="button" className="flex items-center gap-1 text-[11px] font-semibold text-steel hover:text-teal cursor-pointer" onClick={() => setShow((s) => !s)}>
        {show ? <ChevronUp size={12} /> : <ChevronDown size={12} />} Historial de subidas ({history.length})
      </button>
      {show && (
        <div className="mt-2 flex flex-col gap-1">
          {history.map((b) => (
            <button key={b.id} type="button" className="text-left text-[11px] text-steel hover:text-teal cursor-pointer flex flex-wrap items-center gap-x-1.5" onClick={() => onView(b.id)}>
              <span className="font-mono">{fmt(b.requestedAt)}</span>
              <span>—</span>
              <span className="font-semibold">{b.requestedByName}</span>
              <span>
                · {sourceLabel(b.source)} · {b.totalRows} filas{b.skippedCount > 0 ? `, ${b.skippedCount} ignoradas` : ""}
              </span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
