"use client";

import { useEffect, useState } from "react";
import { PackagePlus } from "lucide-react";
import { CatalogCode } from "@/components/shared/CatalogCode";
import { formatDateTime } from "@/lib/formatDateTime";

type ReportDTO = {
  id: string;
  code: string;
  guideNumber: string;
  batchManagedAt: string;
  batchManagedBy: { name: string } | null;
  fulfillmentRemovedAt: string;
  fulfillmentRemovedBy: { name: string } | null;
  items: { id: string; declaredName: string; quantity: number; catalogItem: { name: string; justCode: string | null } | null }[];
};

async function postJson(url: string) {
  const res = await fetch(url, { method: "POST" });
  const data = await res.json().catch(() => null);
  if (!res.ok) throw new Error(data?.error ?? "Ocurrió un error.");
  return data;
}

export function CancelledGuideReingresoQueue() {
  const [reports, setReports] = useState<ReportDTO[] | null>(null);
  const [confirmingId, setConfirmingId] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  function load() {
    fetch("/api/cancelled-guides/pending-reingreso").then((r) => r.json()).then(setReports).catch(() => setReports([]));
  }
  useEffect(load, []);

  async function confirm(id: string) {
    setSaving(true);
    setError("");
    try {
      await postJson(`/api/cancelled-guides/${id}/reingreso`);
      setConfirmingId(null);
      load();
    } catch (e) {
      setError(e instanceof Error ? e.message : "No se pudo confirmar.");
    } finally {
      setSaving(false);
    }
  }

  if (reports === null) return <div className="text-[13px] text-steel">Cargando…</div>;
  if (reports.length === 0) return <div className="text-[13px] text-steel">No hay guías confirmadas pendientes de reingresar a Just.</div>;

  return (
    <div className="flex flex-col gap-2.5 max-w-lg">
      {reports.map((r) => (
        <div key={r.id} className="bg-surface border border-rule rounded-md p-3.5">
          <div className="flex items-center gap-2 mb-1.5">
            <span className="font-mono text-[11px] font-bold text-teal">{r.code}</span>
            <span className="text-[11px] text-steel">Guía {r.guideNumber}</span>
          </div>
          <div className="text-[10.5px] text-steel mb-1">Aprobó {r.batchManagedBy?.name ?? "—"} · {formatDateTime(r.batchManagedAt)}</div>
          <div className="text-[10.5px] text-steel mb-2">Sacó de Fulfillment {r.fulfillmentRemovedBy?.name ?? "—"} · {formatDateTime(r.fulfillmentRemovedAt)}</div>
          <div className="text-[10.5px] font-semibold text-ink mb-1">No despachar:</div>
          <div className="flex flex-col gap-0.5 mb-2.5">
            {r.items.map((it) => (
              <div key={it.id} className="text-[12px] flex items-center gap-1.5">
                {it.catalogItem && <CatalogCode code={it.catalogItem.justCode} />}
                <span>{it.catalogItem?.name ?? it.declaredName} — {it.quantity} un.</span>
              </div>
            ))}
          </div>

          {confirmingId === r.id ? (
            <div className="bg-cloud rounded-md p-2.5">
              <div className="text-[12px] font-semibold mb-2">¿Ya reingresaste esta mercadería en Just?</div>
              {error && <div className="text-red text-[11px] mb-1.5">{error}</div>}
              <div className="flex gap-2">
                <button type="button" className="flex-1 rounded border border-rule px-2.5 py-1.5 text-[11.5px] font-semibold cursor-pointer" onClick={() => setConfirmingId(null)}>Cancelar</button>
                <button type="button" disabled={saving} className="flex-1 rounded border border-teal bg-teal px-2.5 py-1.5 text-[11.5px] font-bold text-navy cursor-pointer disabled:opacity-60" onClick={() => confirm(r.id)}>
                  {saving ? "Confirmando…" : "Sí, ya lo hice"}
                </button>
              </div>
            </div>
          ) : (
            <button type="button" className="flex items-center gap-1.5 text-[11.5px] font-bold border border-teal text-teal rounded px-2.5 py-1.5 cursor-pointer" onClick={() => setConfirmingId(r.id)}>
              <PackagePlus size={13} /> Reingresar a Just
            </button>
          )}
        </div>
      ))}
    </div>
  );
}
