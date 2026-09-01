"use client";

import { useEffect, useState } from "react";
import { CheckCircle2, Trash2 } from "lucide-react";
import { ProofPreview } from "@/components/shared/ProofPreview";
import { CatalogCode } from "@/components/shared/CatalogCode";
import { formatDateTime } from "@/lib/formatDateTime";

type SaleItemDTO = {
  id: string;
  declaredProductName: string;
  catalogItem: { name: string; justCode: string | null } | null;
  quantity: number;
  unitPrice: number;
  totalAmount: number;
};

type SaleDTO = {
  id: string;
  code: string;
  items: SaleItemDTO[];
  totalAmount: number;
  paymentProofUrl: string;
  paymentProofName: string | null;
  paymentProofUploadedAt: string | null;
  client: { name: string; phone: string } | null;
  advisor: { name: string } | null;
};

async function postJson(url: string) {
  const res = await fetch(url, { method: "POST" });
  const data = await res.json().catch(() => null);
  if (!res.ok) throw new Error(data?.error ?? "Ocurrió un error.");
  return data;
}

export function ExternalSalePaymentConfirmInbox() {
  const [sales, setSales] = useState<SaleDTO[] | null>(null);
  const [confirmingId, setConfirmingId] = useState<string | null>(null);
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  function load() {
    fetch("/api/external-sales/pending-payment-confirm").then((r) => r.json()).then(setSales).catch(() => setSales([]));
  }
  useEffect(load, []);

  async function confirm(id: string) {
    setSaving(true);
    setError("");
    try {
      await postJson(`/api/external-sales/${id}/confirm-payment`);
      setConfirmingId(null);
      load();
    } catch (e) {
      setError(e instanceof Error ? e.message : "No se pudo confirmar.");
    } finally {
      setSaving(false);
    }
  }

  async function remove(id: string) {
    setSaving(true);
    setError("");
    try {
      const res = await fetch(`/api/external-sales/${id}`, { method: "DELETE" });
      const data = await res.json().catch(() => null);
      if (!res.ok) throw new Error(data?.error ?? "No se pudo eliminar.");
      setDeletingId(null);
      load();
    } catch (e) {
      setError(e instanceof Error ? e.message : "No se pudo eliminar.");
    } finally {
      setSaving(false);
    }
  }

  if (sales === null) return <div className="text-[13px] text-steel">Cargando…</div>;
  if (sales.length === 0) return <div className="text-[13px] text-steel">No hay comprobantes pendientes de confirmar.</div>;

  return (
    <div className="flex flex-col gap-2.5 max-w-lg">
      {sales.map((s) => (
        <div key={s.id} className="bg-surface border border-rule rounded-md p-3.5">
          <div className="flex items-center gap-2 mb-1.5">
            <span className="font-mono text-[11px] font-bold text-teal">{s.code}</span>
            <span className="text-[11px] text-steel">Registrado por {s.advisor?.name ?? "—"}</span>
          </div>
          <div className="flex flex-col gap-0.5 mb-1.5">
            {s.items.map((it) => (
              <div key={it.id} className="text-[13px] font-semibold flex items-center gap-1.5 flex-wrap">
                {it.catalogItem && <CatalogCode code={it.catalogItem.justCode} />}
                <span>{it.catalogItem?.name ?? it.declaredProductName} — {it.quantity} und. × ${it.unitPrice.toFixed(2)} = ${it.totalAmount.toFixed(2)}</span>
              </div>
            ))}
          </div>
          <div className="text-[12px] font-bold mb-1.5">Total: ${s.totalAmount.toFixed(2)}</div>
          <div className="text-[11px] text-steel mb-1.5">
            Comprobante subido: {s.paymentProofUploadedAt ? formatDateTime(s.paymentProofUploadedAt) : "—"}
          </div>
          <div className="text-[11px] text-steel mb-1.5">
            Cliente: {s.client ? `${s.client.name} · ${s.client.phone}` : "—"}
          </div>
          <ProofPreview url={s.paymentProofUrl} filename={s.paymentProofName ?? undefined} size={56} />

          {confirmingId === s.id ? (
            <div className="bg-cloud rounded-md p-2.5 mt-2.5">
              <div className="text-[12px] font-semibold mb-2">¿Confirmás que llegó el dinero completo?</div>
              {error && <div className="text-red text-[11px] mb-1.5">{error}</div>}
              <div className="flex gap-2">
                <button type="button" className="flex-1 rounded border border-rule px-2.5 py-1.5 text-[11.5px] font-semibold cursor-pointer" onClick={() => setConfirmingId(null)}>Cancelar</button>
                <button type="button" disabled={saving} className="flex-1 rounded border border-teal bg-teal px-2.5 py-1.5 text-[11.5px] font-bold text-navy cursor-pointer disabled:opacity-60" onClick={() => confirm(s.id)}>
                  {saving ? "Confirmando…" : "Sí, ya llegó"}
                </button>
              </div>
            </div>
          ) : deletingId === s.id ? (
            <div className="bg-cloud rounded-md p-2.5 mt-2.5">
              <div className="text-[12px] font-semibold mb-2">¿Eliminar esta solicitud por completo? No se puede deshacer — para volver a declararla, hay que hacerlo de cero.</div>
              {error && <div className="text-red text-[11px] mb-1.5">{error}</div>}
              <div className="flex gap-2">
                <button type="button" className="flex-1 rounded border border-rule px-2.5 py-1.5 text-[11.5px] font-semibold cursor-pointer" onClick={() => setDeletingId(null)}>Cancelar</button>
                <button type="button" disabled={saving} className="flex-1 rounded border border-red bg-red px-2.5 py-1.5 text-[11.5px] font-bold text-white cursor-pointer disabled:opacity-60" onClick={() => remove(s.id)}>
                  {saving ? "Eliminando…" : "Sí, eliminar"}
                </button>
              </div>
            </div>
          ) : (
            <div className="flex items-center gap-2 mt-2.5">
              <button type="button" className="flex items-center gap-1.5 text-[11.5px] font-bold border border-teal text-teal rounded px-2.5 py-1.5 cursor-pointer" onClick={() => setConfirmingId(s.id)}>
                <CheckCircle2 size={13} /> Confirmar recibido
              </button>
              <button type="button" className="flex items-center gap-1.5 text-[11.5px] font-bold border border-rule text-steel rounded px-2.5 py-1.5 cursor-pointer" onClick={() => setDeletingId(s.id)}>
                <Trash2 size={13} /> Eliminar
              </button>
            </div>
          )}
        </div>
      ))}
    </div>
  );
}
