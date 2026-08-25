"use client";

import { useEffect, useState } from "react";
import { CheckCircle2, XCircle } from "lucide-react";

type SaleDTO = {
  id: string;
  code: string;
  declaredProductName: string;
  catalogItem: { name: string; photos: string[] } | null;
  quantity: number;
  unitPrice: number;
  totalAmount: number;
  pickupPersonName: string;
  courierNote: string | null;
  advisor: { name: string } | null;
};

async function postJson(url: string, body?: unknown) {
  const res = await fetch(url, { method: "POST", headers: { "Content-Type": "application/json" }, body: body ? JSON.stringify(body) : undefined });
  const data = await res.json().catch(() => null);
  if (!res.ok) throw new Error(data?.error ?? "Ocurrió un error.");
  return data;
}

export function ExternalSaleReviewInbox() {
  const [sales, setSales] = useState<SaleDTO[] | null>(null);
  const [rejecting, setRejecting] = useState<string | null>(null);
  const [reason, setReason] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  function load() {
    fetch("/api/external-sales/pending-review").then((r) => r.json()).then(setSales).catch(() => setSales([]));
  }
  useEffect(load, []);

  async function approve(id: string) {
    setSaving(true);
    setError("");
    try {
      await postJson(`/api/external-sales/${id}/review`, { approved: true });
      load();
    } catch (e) {
      setError(e instanceof Error ? e.message : "No se pudo aprobar.");
    } finally {
      setSaving(false);
    }
  }

  async function reject(id: string) {
    if (!reason.trim()) return;
    setSaving(true);
    setError("");
    try {
      await postJson(`/api/external-sales/${id}/review`, { approved: false, rejectionReason: reason.trim() });
      setRejecting(null);
      setReason("");
      load();
    } catch (e) {
      setError(e instanceof Error ? e.message : "No se pudo rechazar.");
    } finally {
      setSaving(false);
    }
  }

  if (sales === null) return <div className="text-[13px] text-steel">Cargando…</div>;
  if (sales.length === 0) return <div className="text-[13px] text-steel">No hay ventas pendientes de revisión.</div>;

  return (
    <div className="flex flex-col gap-2.5 max-w-lg">
      {sales.map((s) => (
        <div key={s.id} className="bg-surface border border-rule rounded-md p-3.5">
          <div className="flex items-center gap-2 mb-1.5">
            <span className="font-mono text-[11px] font-bold text-teal">{s.code}</span>
            <span className="text-[11px] text-steel">{s.advisor?.name ?? "—"}</span>
          </div>
          <div className="text-[13px] font-semibold">{s.catalogItem?.name ?? s.declaredProductName}</div>
          <div className="text-[12px] text-steel mb-1">{s.quantity} un. × ${s.unitPrice.toFixed(2)} = <span className="font-bold text-ink">${s.totalAmount.toFixed(2)}</span></div>
          <div className="text-[11.5px] text-steel">Entrega a: {s.pickupPersonName}</div>
          {s.courierNote && <div className="text-[11.5px] text-steel">Transportadora: {s.courierNote}</div>}

          {rejecting === s.id ? (
            <div className="bg-cloud rounded-md p-2.5 mt-2.5">
              <textarea className="w-full rounded border border-rule bg-surface px-2.5 py-1.5 text-[12px] mb-2" rows={2} placeholder="Motivo del rechazo…" value={reason} onChange={(e) => setReason(e.target.value)} />
              {error && <div className="text-red text-[11px] mb-1.5">{error}</div>}
              <div className="flex gap-2">
                <button type="button" className="flex-1 rounded border border-rule px-2.5 py-1.5 text-[11.5px] font-semibold cursor-pointer" onClick={() => { setRejecting(null); setReason(""); }}>Cancelar</button>
                <button type="button" disabled={saving || !reason.trim()} className="flex-1 rounded border border-red bg-red px-2.5 py-1.5 text-[11.5px] font-bold text-white cursor-pointer disabled:opacity-40" onClick={() => reject(s.id)}>
                  {saving ? "Guardando…" : "Confirmar rechazo"}
                </button>
              </div>
            </div>
          ) : (
            <div className="flex gap-1.5 mt-2.5">
              <button type="button" disabled={saving} className="flex items-center gap-1 text-[11.5px] font-semibold border border-green/40 text-green rounded-full px-2.5 py-1 cursor-pointer disabled:opacity-40" onClick={() => approve(s.id)}>
                <CheckCircle2 size={12} /> Aprobar
              </button>
              <button type="button" className="flex items-center gap-1 text-[11.5px] font-semibold border border-red/40 text-red rounded-full px-2.5 py-1 cursor-pointer" onClick={() => setRejecting(s.id)}>
                <XCircle size={12} /> Rechazar
              </button>
            </div>
          )}
        </div>
      ))}
    </div>
  );
}
