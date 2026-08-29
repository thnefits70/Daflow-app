"use client";

import { useEffect, useState } from "react";
import { CheckCircle2, XCircle } from "lucide-react";
import { CARRIER_LABELS } from "@/lib/cancelledGuidesLabels";
import { formatDateTime } from "@/lib/formatDateTime";
import { CatalogCode } from "@/components/shared/CatalogCode";

type ReportDTO = {
  id: string;
  code: string;
  guideNumber: string;
  carrier: keyof typeof CARRIER_LABELS;
  reason: string;
  fulfillmentConfirmedAt: string | null;
  inventoryConfirmedAt: string | null;
  submittedBy: { name: string } | null;
  fulfillmentConfirmedBy: { name: string } | null;
  inventoryConfirmedBy: { name: string } | null;
  items: { id: string; declaredName: string; quantity: number; catalogItem: { name: string; justCode: string | null } | null }[];
};

async function postJson(url: string, body?: unknown) {
  const res = await fetch(url, { method: "POST", headers: { "Content-Type": "application/json" }, body: body ? JSON.stringify(body) : undefined });
  const data = await res.json().catch(() => null);
  if (!res.ok) throw new Error(data?.error ?? "Ocurrió un error.");
  return data;
}

// Confirmado 2026-08-25: pedido explícito del usuario — el corte semanal es
// juicio de Bryan (qué pasó de verdad en Dropi/Rocket), no algo que el
// sistema pueda decidir solo con las confirmaciones internas.
export function CancelledGuideCutoffInbox() {
  const [reports, setReports] = useState<ReportDTO[] | null>(null);
  const [savingId, setSavingId] = useState<string | null>(null);
  const [error, setError] = useState("");

  function load() {
    fetch("/api/cancelled-guides/pending-cutoff").then((r) => r.json()).then(setReports).catch(() => setReports([]));
  }
  useEffect(load, []);

  async function decide(id: string, reallyCancelled: boolean) {
    setSavingId(id);
    setError("");
    try {
      await postJson(`/api/cancelled-guides/${id}/cutoff-decision`, { reallyCancelled });
      load();
    } catch (e) {
      setError(e instanceof Error ? e.message : "No se pudo guardar la decisión.");
    } finally {
      setSavingId(null);
    }
  }

  if (reports === null) return <div className="text-[13px] text-steel">Cargando…</div>;
  if (reports.length === 0) return <div className="text-[13px] text-steel">No hay guías pendientes de decidir.</div>;

  return (
    <div className="flex flex-col gap-2.5 max-w-lg">
      {error && <div className="text-red text-[12px]">{error}</div>}
      {reports.map((r) => (
        <div key={r.id} className="bg-surface border border-rule rounded-md p-3.5">
          <div className="flex items-center gap-2 mb-1.5">
            <span className="font-mono text-[11px] font-bold text-teal">{r.code}</span>
            <span className="text-[11px] text-steel">Guía {r.guideNumber} · {CARRIER_LABELS[r.carrier]}</span>
          </div>
          <div className="flex flex-col gap-0.5 mb-2">
            {r.items.map((it) => (
              <div key={it.id} className="text-[12px] flex items-center gap-1.5">
                {it.catalogItem && <CatalogCode code={it.catalogItem.justCode} />}
                <span>{it.catalogItem?.name ?? it.declaredName} — {it.quantity} un.</span>
              </div>
            ))}
          </div>
          <div className="text-[11.5px] text-steel mb-1">{r.reason} · reportó {r.submittedBy?.name ?? "—"}</div>
          <div className="text-[10.5px] text-steel mb-2.5">
            Fulfillment: {r.fulfillmentConfirmedBy?.name ?? "sin confirmar"}{r.fulfillmentConfirmedAt ? ` · ${formatDateTime(r.fulfillmentConfirmedAt)}` : ""}
            {" — "}Inventario: {r.inventoryConfirmedBy?.name ?? "sin confirmar"}{r.inventoryConfirmedAt ? ` · ${formatDateTime(r.inventoryConfirmedAt)}` : ""}
          </div>

          <div className="flex gap-1.5">
            <button type="button" disabled={savingId === r.id} className="flex items-center gap-1 text-[11.5px] font-semibold border border-green/40 text-green rounded-full px-2.5 py-1 cursor-pointer disabled:opacity-40" onClick={() => decide(r.id, true)}>
              <CheckCircle2 size={12} /> Realmente se canceló
            </button>
            <button type="button" disabled={savingId === r.id} className="flex items-center gap-1 text-[11.5px] font-semibold border border-red/40 text-red rounded-full px-2.5 py-1 cursor-pointer disabled:opacity-40" onClick={() => decide(r.id, false)}>
              <XCircle size={12} /> Se despachó igual
            </button>
          </div>
        </div>
      ))}
    </div>
  );
}
