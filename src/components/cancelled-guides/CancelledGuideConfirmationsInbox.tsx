"use client";

import { useEffect, useState } from "react";
import { CheckCircle2 } from "lucide-react";
import { CARRIER_LABELS } from "@/lib/cancelledGuidesLabels";

type ReportDTO = {
  id: string;
  code: string;
  guideNumber: string;
  carrier: keyof typeof CARRIER_LABELS;
  reason: string;
  fulfillmentConfirmedAt: string | null;
  inventoryConfirmedAt: string | null;
  submittedBy: { name: string } | null;
  items: { id: string; declaredName: string; quantity: number; catalogItem: { name: string } | null }[];
};

async function postJson(url: string) {
  const res = await fetch(url, { method: "POST" });
  const data = await res.json().catch(() => null);
  if (!res.ok) throw new Error(data?.error ?? "Ocurrió un error.");
  return data;
}

export function CancelledGuideConfirmationsInbox() {
  const [reports, setReports] = useState<ReportDTO[] | null>(null);
  const [flags, setFlags] = useState({ canFulfillment: false, canInventory: false });
  const [savingId, setSavingId] = useState<string | null>(null);
  const [error, setError] = useState("");

  function load() {
    fetch("/api/cancelled-guides/pending-confirmations")
      .then((r) => r.json())
      .then((data) => { setReports(data.reports ?? []); setFlags({ canFulfillment: !!data.canFulfillment, canInventory: !!data.canInventory }); })
      .catch(() => setReports([]));
  }
  useEffect(load, []);

  async function confirm(id: string, which: "confirm-fulfillment" | "confirm-inventory") {
    setSavingId(id);
    setError("");
    try {
      await postJson(`/api/cancelled-guides/${id}/${which}`);
      load();
    } catch (e) {
      setError(e instanceof Error ? e.message : "No se pudo confirmar.");
    } finally {
      setSavingId(null);
    }
  }

  if (reports === null) return <div className="text-[13px] text-steel">Cargando…</div>;
  if (reports.length === 0) return <div className="text-[13px] text-steel">No hay guías canceladas pendientes de tu confirmación.</div>;

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
              <div key={it.id} className="text-[12px]">{it.catalogItem?.name ?? it.declaredName} — {it.quantity} un.</div>
            ))}
          </div>
          <div className="text-[11.5px] text-steel mb-2.5">{r.reason} · reportó {r.submittedBy?.name ?? "—"}</div>

          <div className="flex gap-1.5 flex-wrap">
            {flags.canFulfillment && !r.fulfillmentConfirmedAt && (
              <button type="button" disabled={savingId === r.id} className="flex items-center gap-1 text-[11.5px] font-semibold border border-teal text-teal rounded-full px-2.5 py-1 cursor-pointer disabled:opacity-40" onClick={() => confirm(r.id, "confirm-fulfillment")}>
                <CheckCircle2 size={12} /> Confirmar (Fulfillment)
              </button>
            )}
            {flags.canInventory && !r.inventoryConfirmedAt && (
              <button type="button" disabled={savingId === r.id} className="flex items-center gap-1 text-[11.5px] font-semibold border border-teal text-teal rounded-full px-2.5 py-1 cursor-pointer disabled:opacity-40" onClick={() => confirm(r.id, "confirm-inventory")}>
                <CheckCircle2 size={12} /> Confirmar (Inventario)
              </button>
            )}
          </div>
        </div>
      ))}
    </div>
  );
}
