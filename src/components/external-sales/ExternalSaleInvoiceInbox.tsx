"use client";

import { useEffect, useState } from "react";
import { Upload } from "lucide-react";
import { ProofPreview } from "@/components/shared/ProofPreview";
import { CatalogCode } from "@/components/shared/CatalogCode";
import { uploadFile } from "@/lib/uploadFile";

type SaleItemDTO = {
  id: string;
  declaredProductName: string;
  catalogItem: { name: string; justCode: string | null } | null;
  quantity: number;
};

type SaleDTO = {
  id: string;
  code: string;
  items: SaleItemDTO[];
  totalAmount: number;
  isContraEntrega: boolean;
  paymentProofUrl: string;
  paymentProofName: string | null;
  advisor: { name: string } | null;
  client: { name: string; idType: "RUC" | "CEDULA"; idNumber: string; phone: string; email: string | null; address: string; country: string | null; city: string | null } | null;
};

async function postJson(url: string, body?: unknown) {
  const res = await fetch(url, { method: "POST", headers: { "Content-Type": "application/json" }, body: body ? JSON.stringify(body) : undefined });
  const data = await res.json().catch(() => null);
  if (!res.ok) throw new Error(data?.error ?? "Ocurrió un error.");
  return data;
}

export function ExternalSaleInvoiceInbox() {
  const [sales, setSales] = useState<SaleDTO[] | null>(null);
  const [uploadingFor, setUploadingFor] = useState<string | null>(null);
  const [error, setError] = useState("");

  function load() {
    fetch("/api/external-sales/pending-invoice").then((r) => r.json()).then(setSales).catch(() => setSales([]));
  }
  useEffect(load, []);

  async function uploadInvoice(saleId: string, file: File) {
    setUploadingFor(saleId);
    setError("");
    const uploaded = await uploadFile(file, "external-sale-invoices");
    if (!uploaded.ok) {
      setError(uploaded.error);
      setUploadingFor(null);
      return;
    }
    try {
      await postJson(`/api/external-sales/${saleId}/invoice`, { invoiceUrl: uploaded.url, invoiceName: uploaded.name });
      load();
    } catch (e) {
      setError(e instanceof Error ? e.message : "No se pudo subir la factura.");
    } finally {
      setUploadingFor(null);
    }
  }

  if (sales === null) return <div className="text-[13px] text-steel">Cargando…</div>;
  if (sales.length === 0) return <div className="text-[13px] text-steel">No hay ventas pendientes de facturar.</div>;

  return (
    <div className="flex flex-col gap-2.5 max-w-lg">
      {error && <div className="text-red text-[11.5px]">{error}</div>}
      {sales.map((s) => (
        <div key={s.id} className="bg-surface border border-rule rounded-md p-3.5">
          <div className="flex items-center gap-2 mb-1.5">
            <span className="font-mono text-[11px] font-bold text-teal">{s.code}</span>
            <span className="text-[11px] text-steel">{s.advisor?.name ?? "—"}</span>
            {s.isContraEntrega && <span className="font-mono text-[9.5px] font-bold uppercase text-blue">Opcional — contra entrega</span>}
          </div>
          <div className="flex flex-col gap-0.5 mb-1">
            {s.items.map((it) => (
              <div key={it.id} className="text-[13px] font-semibold flex items-center gap-1.5 flex-wrap">
                {it.catalogItem && <CatalogCode code={it.catalogItem.justCode} />}
                <span>{it.catalogItem?.name ?? it.declaredProductName} — {it.quantity} un.</span>
              </div>
            ))}
          </div>
          <div className="text-[12px] font-bold mb-1">Total: ${s.totalAmount.toFixed(2)}</div>
          <ProofPreview url={s.paymentProofUrl} filename={s.paymentProofName ?? undefined} size={56} />

          {s.client && (
            <div className="bg-cloud rounded-md p-2.5 mt-2.5 text-[11.5px] flex flex-col gap-0.5">
              <div className="font-semibold">{s.client.name}</div>
              <div className="text-steel">{s.client.idType === "RUC" ? "RUC" : "Cédula"}: {s.client.idNumber} · Cel: {s.client.phone}</div>
              {s.client.email && <div className="text-steel">Correo: {s.client.email}</div>}
              <div className="text-steel">{s.client.address}</div>
              {(s.client.city || s.client.country) && (
                <div className="text-steel">{[s.client.city, s.client.country].filter(Boolean).join(", ")}</div>
              )}
            </div>
          )}

          <label className="mt-2.5 inline-flex items-center gap-1.5 text-[11.5px] font-bold border border-teal text-teal rounded px-2.5 py-1.5 cursor-pointer">
            <Upload size={13} /> {uploadingFor === s.id ? "Subiendo…" : "Subir factura"}
            <input type="file" accept="image/*,.pdf" className="hidden" onChange={(e) => { const f = e.target.files?.[0]; if (f) uploadInvoice(s.id, f); }} />
          </label>
        </div>
      ))}
    </div>
  );
}
