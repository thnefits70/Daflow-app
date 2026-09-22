"use client";

import { useEffect, useMemo, useState } from "react";
import { Upload } from "lucide-react";
import { ProofPreview } from "@/components/shared/ProofPreview";
import { CatalogCode } from "@/components/shared/CatalogCode";
import { uploadFile } from "@/lib/uploadFile";

type FacturaSolicitud = "SI" | "NO" | "PENDIENTE";

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
  facturaSolicitada: FacturaSolicitud;
  paymentProofUrl: string;
  paymentProofName: string | null;
  advisor: { name: string } | null;
  client: { name: string; idType: "RUC" | "CEDULA" | null; idNumber: string | null; phone: string; email: string | null; address: string; country: string | null; city: string | null } | null;
};

type Filter = "requieren" | "no_requieren" | "todas";

async function postJson(url: string, body?: unknown) {
  const res = await fetch(url, { method: "POST", headers: { "Content-Type": "application/json" }, body: body ? JSON.stringify(body) : undefined });
  const data = await res.json().catch(() => null);
  if (!res.ok) throw new Error(data?.error ?? "Ocurrió un error.");
  return data;
}

// Confirmado 2026-09-22: "NO" es la única señal real de que el cliente no
// pidió factura — antes se exigía además isContraEntrega, pero un asesor B2C
// también puede vender "sin recaudo" puntualmente y tener clientes que
// tampoco la pidan (ver mismo criterio en close/route.ts). Un asesor B2B
// nunca llega a "NO" — su facturaSolicitada queda fija en PENDIENTE (ver
// POST/[id] routes), así que esta función sigue siendo correcta para ellos.
function noRequiereFactura(s: SaleDTO) {
  return s.facturaSolicitada === "NO";
}

function facturaBadge(s: SaleDTO) {
  if (s.facturaSolicitada === "SI") return { text: "Factura solicitada", className: "text-red" };
  if (s.facturaSolicitada === "NO") return { text: "No requiere factura", className: "text-steel" };
  return null;
}

export function ExternalSaleInvoiceInbox() {
  const [sales, setSales] = useState<SaleDTO[] | null>(null);
  const [uploadingFor, setUploadingFor] = useState<string | null>(null);
  const [filter, setFilter] = useState<Filter>("requieren");
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

  const counts = useMemo(() => {
    const all = sales ?? [];
    const noRequieren = all.filter(noRequiereFactura).length;
    return { todas: all.length, requieren: all.length - noRequieren, no_requieren: noRequieren };
  }, [sales]);

  const visibleSales = useMemo(() => {
    const all = sales ?? [];
    if (filter === "todas") return all;
    if (filter === "no_requieren") return all.filter(noRequiereFactura);
    return all.filter((s) => !noRequiereFactura(s));
  }, [sales, filter]);

  if (sales === null) return <div className="text-[13px] text-steel">Cargando…</div>;
  if (sales.length === 0) return <div className="text-[13px] text-steel">No hay ventas pendientes de facturar.</div>;

  const FILTERS: { value: Filter; label: string }[] = [
    { value: "requieren", label: `Requieren factura (${counts.requieren})` },
    { value: "no_requieren", label: `No requieren (${counts.no_requieren})` },
    { value: "todas", label: `Todas (${counts.todas})` },
  ];

  return (
    <div className="flex flex-col gap-2.5 max-w-lg">
      <div className="flex gap-1.5 flex-wrap">
        {FILTERS.map((f) => (
          <button
            key={f.value}
            type="button"
            className={`rounded px-2.5 py-1.5 text-[11px] font-bold cursor-pointer border ${filter === f.value ? "border-teal bg-teal text-navy" : "border-rule text-steel"}`}
            onClick={() => setFilter(f.value)}
          >
            {f.label}
          </button>
        ))}
      </div>

      {error && <div className="text-red text-[11.5px]">{error}</div>}

      {visibleSales.length === 0 && <div className="text-[13px] text-steel">Nada en este filtro.</div>}

      {visibleSales.map((s) => {
        const badge = facturaBadge(s);
        return (
          <div key={s.id} className="bg-surface border border-rule rounded-md p-3.5">
            <div className="flex items-center gap-2 mb-1.5">
              <span className="font-mono text-[11px] font-bold text-teal">{s.code}</span>
              <span className="text-[11px] text-steel">{s.advisor?.name ?? "—"}</span>
              {badge && <span className={`font-mono text-[9.5px] font-bold uppercase ${badge.className}`}>{badge.text}</span>}
            </div>
            <div className="flex flex-col gap-0.5 mb-1">
              {s.items.map((it) => (
                <div key={it.id} className="text-[13px] font-semibold flex items-center gap-1.5 flex-wrap">
                  {it.catalogItem && <CatalogCode code={it.catalogItem.justCode} />}
                  <span>{it.catalogItem?.name ?? it.declaredProductName} — {it.quantity} un. × ${it.unitPrice.toFixed(2)} = ${it.totalAmount.toFixed(2)}</span>
                </div>
              ))}
            </div>
            <div className="text-[12px] font-bold mb-1">Total: ${s.totalAmount.toFixed(2)}</div>
            <ProofPreview url={s.paymentProofUrl} filename={s.paymentProofName ?? undefined} size={56} />

            {s.client && (
              <div className="bg-cloud rounded-md p-2.5 mt-2.5 text-[11.5px] flex flex-col gap-0.5">
                <div className="font-semibold">{s.client.name}</div>
                <div className="text-steel">{s.client.idNumber ? `${s.client.idType === "RUC" ? "RUC" : "Cédula"}: ${s.client.idNumber} · ` : ""}Cel: {s.client.phone}</div>
                {s.client.email && <div className="text-steel">Correo: {s.client.email}</div>}
                <div className="text-steel">{s.client.address}</div>
                {(s.client.city || s.client.country) && (
                  <div className="text-steel">{[s.client.city, s.client.country].filter(Boolean).join(", ")}</div>
                )}
              </div>
            )}

            {!noRequiereFactura(s) && (
              <label className="mt-2.5 inline-flex items-center gap-1.5 text-[11.5px] font-bold border border-teal text-teal rounded px-2.5 py-1.5 cursor-pointer">
                <Upload size={13} /> {uploadingFor === s.id ? "Subiendo…" : "Subir factura"}
                <input type="file" accept="image/*,.pdf" className="hidden" onChange={(e) => { const f = e.target.files?.[0]; if (f) uploadInvoice(s.id, f); }} />
              </label>
            )}
          </div>
        );
      })}
    </div>
  );
}
