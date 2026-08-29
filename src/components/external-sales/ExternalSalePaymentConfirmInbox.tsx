"use client";

import { useEffect, useState } from "react";
import { CheckCircle2 } from "lucide-react";
import { ProofPreview } from "@/components/shared/ProofPreview";
import { CatalogCode } from "@/components/shared/CatalogCode";

type SaleDTO = {
  id: string;
  code: string;
  declaredProductName: string;
  catalogItem: { name: string; justCode: string | null } | null;
  totalAmount: number;
  paymentProofUrl: string;
  paymentProofName: string | null;
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

  if (sales === null) return <div className="text-[13px] text-steel">Cargando…</div>;
  if (sales.length === 0) return <div className="text-[13px] text-steel">No hay comprobantes pendientes de confirmar.</div>;

  return (
    <div className="flex flex-col gap-2.5 max-w-lg">
      {sales.map((s) => (
        <div key={s.id} className="bg-surface border border-rule rounded-md p-3.5">
          <div className="flex items-center gap-2 mb-1.5">
            <span className="font-mono text-[11px] font-bold text-teal">{s.code}</span>
            <span className="text-[11px] text-steel">{s.advisor?.name ?? "—"}</span>
          </div>
          <div className="text-[13px] font-semibold mb-1 flex items-center gap-1.5 flex-wrap">
            {s.catalogItem && <CatalogCode code={s.catalogItem.justCode} />}
            <span>{s.catalogItem?.name ?? s.declaredProductName} — ${s.totalAmount.toFixed(2)}</span>
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
          ) : (
            <button type="button" className="flex items-center gap-1.5 text-[11.5px] font-bold border border-teal text-teal rounded px-2.5 py-1.5 cursor-pointer mt-2.5" onClick={() => setConfirmingId(s.id)}>
              <CheckCircle2 size={13} /> Confirmar recibido
            </button>
          )}
        </div>
      ))}
    </div>
  );
}
