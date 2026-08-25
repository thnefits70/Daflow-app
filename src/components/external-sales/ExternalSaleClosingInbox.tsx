"use client";

import { useEffect, useState } from "react";
import { CheckCircle2 } from "lucide-react";
import { ProofPreview } from "@/components/shared/ProofPreview";

type SaleDTO = {
  id: string;
  code: string;
  declaredProductName: string;
  catalogItem: { name: string; photos: string[] } | null;
  quantity: number;
  unitPrice: number;
  totalAmount: number;
  pickupPersonName: string;
  paymentProofUrl: string | null;
  paymentProofName: string | null;
  deliveryPhotoUrl: string | null;
  advisor: { name: string } | null;
  dispatchAssignedTo: { name: string } | null;
  deliveredBy: { name: string } | null;
};

async function postJson(url: string) {
  const res = await fetch(url, { method: "POST" });
  const data = await res.json().catch(() => null);
  if (!res.ok) throw new Error(data?.error ?? "Ocurrió un error.");
  return data;
}

export function ExternalSaleClosingInbox() {
  const [sales, setSales] = useState<SaleDTO[] | null>(null);
  const [closingId, setClosingId] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  function load() {
    fetch("/api/external-sales/pending-close").then((r) => r.json()).then(setSales).catch(() => setSales([]));
  }
  useEffect(load, []);

  async function close(id: string) {
    setSaving(true);
    setError("");
    try {
      await postJson(`/api/external-sales/${id}/close`);
      setClosingId(null);
      load();
    } catch (e) {
      setError(e instanceof Error ? e.message : "No se pudo cerrar.");
    } finally {
      setSaving(false);
    }
  }

  if (sales === null) return <div className="text-[13px] text-steel">Cargando…</div>;
  if (sales.length === 0) return <div className="text-[13px] text-steel">No hay ventas listas para cerrar.</div>;

  return (
    <div className="flex flex-col gap-2.5 max-w-lg">
      {sales.map((s) => (
        <div key={s.id} className="bg-surface border border-rule rounded-md p-3.5">
          <div className="flex items-center gap-2 mb-1.5">
            <span className="font-mono text-[11px] font-bold text-teal">{s.code}</span>
            <span className="text-[11px] text-steel">{s.advisor?.name ?? "—"}</span>
          </div>
          <div className="text-[13px] font-semibold mb-1">{s.catalogItem?.name ?? s.declaredProductName} — {s.quantity} un. × ${s.unitPrice.toFixed(2)} = <span className="text-teal">${s.totalAmount.toFixed(2)}</span></div>
          <div className="text-[11.5px] text-steel mb-2">Despachó {s.dispatchAssignedTo?.name ?? "—"} · entregó {s.deliveredBy?.name ?? "—"}</div>
          <div className="flex gap-3 mb-2.5">
            {s.paymentProofUrl && <ProofPreview url={s.paymentProofUrl} filename={s.paymentProofName ?? undefined} size={48} />}
            {s.deliveryPhotoUrl && (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={s.deliveryPhotoUrl} alt="Foto de la entrega" className="w-12 h-12 object-cover rounded border border-rule" />
            )}
          </div>

          {closingId === s.id ? (
            <div className="bg-cloud rounded-md p-2.5">
              <div className="text-[12px] font-semibold mb-2">¿Confirmás registrar esta venta como cerrada?</div>
              {error && <div className="text-red text-[11px] mb-1.5">{error}</div>}
              <div className="flex gap-2">
                <button type="button" className="flex-1 rounded border border-rule px-2.5 py-1.5 text-[11.5px] font-semibold cursor-pointer" onClick={() => setClosingId(null)}>Cancelar</button>
                <button type="button" disabled={saving} className="flex-1 rounded border border-teal bg-teal px-2.5 py-1.5 text-[11.5px] font-bold text-navy cursor-pointer disabled:opacity-60" onClick={() => close(s.id)}>
                  {saving ? "Cerrando…" : "Sí, cerrar"}
                </button>
              </div>
            </div>
          ) : (
            <button type="button" className="flex items-center gap-1.5 text-[11.5px] font-bold border border-teal text-teal rounded px-2.5 py-1.5 cursor-pointer" onClick={() => setClosingId(s.id)}>
              <CheckCircle2 size={13} /> Cerrar venta
            </button>
          )}
        </div>
      ))}
    </div>
  );
}
