"use client";

import { useEffect, useState } from "react";
import { CheckCircle2 } from "lucide-react";
import { ProofPreview } from "@/components/shared/ProofPreview";
import { CatalogCode } from "@/components/shared/CatalogCode";

type SaleItemDTO = {
  id: string;
  declaredProductName: string;
  catalogItem: { name: string; photos: string[]; justCode: string | null } | null;
  quantity: number;
  unitPrice: number;
  totalAmount: number;
};
type SaleDTO = {
  id: string;
  code: string;
  items: SaleItemDTO[];
  totalAmount: number;
  pickupPersonName: string;
  isContraEntrega: boolean;
  freightCost: number | null;
  paymentProofUrl: string | null;
  paymentProofName: string | null;
  paymentProofAiReadAmount: number | null;
  deliveryPhotoUrl: string | null;
  facturaSolicitada: "SI" | "NO" | "PENDIENTE";
  invoiceUploadedAt: string | null;
  advisor: { name: string } | null;
  dispatchAssignedTo: { name: string } | null;
  deliveredBy: { name: string } | null;
};

type DifferenceReason = "FLETE_MOTORIZADO" | "OTRO";

async function postJson(url: string, body?: unknown) {
  const res = await fetch(url, {
    method: "POST",
    headers: body ? { "Content-Type": "application/json" } : undefined,
    body: body ? JSON.stringify(body) : undefined,
  });
  const data = await res.json().catch(() => null);
  if (!res.ok) throw new Error(data?.error ?? "Ocurrió un error.");
  return data;
}

// Monto que se espera que haya llegado: con recaudo el motorizado ya
// descontó su flete declarado; si la IA leyó el comprobante, ese manda.
function suggestedReceived(s: SaleDTO): number {
  if (s.paymentProofAiReadAmount != null) return s.paymentProofAiReadAmount;
  if (s.isContraEntrega && s.freightCost) return s.totalAmount - s.freightCost;
  return s.totalAmount;
}

export function ExternalSaleClosingInbox() {
  const [sales, setSales] = useState<SaleDTO[] | null>(null);
  const [closingId, setClosingId] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  // Confirmado 2026-09-24, pedido de Nairoby: justificar por qué lo que
  // llegó no es el total (ej. VE-0006, $9 de flete que se quedó el motorizado).
  const [hasDifference, setHasDifference] = useState(false);
  const [received, setReceived] = useState("");
  const [reason, setReason] = useState<DifferenceReason>("FLETE_MOTORIZADO");
  const [note, setNote] = useState("");

  function load() {
    fetch("/api/external-sales/pending-close").then((r) => r.json()).then(setSales).catch(() => setSales([]));
  }
  useEffect(load, []);

  function openClose(s: SaleDTO) {
    const suggested = suggestedReceived(s);
    const diff = s.totalAmount - suggested > 0.009;
    setClosingId(s.id);
    setHasDifference(diff);
    setReceived(diff ? suggested.toFixed(2) : "");
    setReason("FLETE_MOTORIZADO");
    setNote("");
    setError("");
  }

  async function close(s: SaleDTO) {
    setSaving(true);
    setError("");
    try {
      await postJson(
        `/api/external-sales/${s.id}/close`,
        hasDifference ? { difference: { receivedAmount: Number(received), reason, note: note.trim() || undefined } } : undefined,
      );
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
      {sales.map((s) => {
        const missingInvoice = s.facturaSolicitada !== "NO" && !s.invoiceUploadedAt;
        const receivedNum = Number(received);
        const receivedValid = received.trim() !== "" && Number.isFinite(receivedNum) && receivedNum >= 0 && receivedNum < s.totalAmount;
        const differenceAmount = receivedValid ? s.totalAmount - receivedNum : null;
        const canConfirm = !hasDifference || (receivedValid && (reason !== "OTRO" || note.trim().length >= 3));
        return (
        <div key={s.id} className="bg-surface border border-rule rounded-md p-3.5">
          <div className="flex items-center gap-2 mb-1.5">
            <span className="font-mono text-[11px] font-bold text-teal">{s.code}</span>
            <span className="text-[11px] text-steel">{s.advisor?.name ?? "—"}</span>
          </div>
          <div className="flex flex-col gap-0.5 mb-1">
            {s.items.map((it) => (
              <div key={it.id} className="text-[13px] font-semibold flex items-center gap-1.5 flex-wrap">
                {it.catalogItem && <CatalogCode code={it.catalogItem.justCode} />}
                <span>{it.catalogItem?.name ?? it.declaredProductName} — {it.quantity} un. × ${it.unitPrice.toFixed(2)} = ${it.totalAmount.toFixed(2)}</span>
              </div>
            ))}
          </div>
          <div className="text-[12px] font-bold mb-1">Total: <span className="text-teal">${s.totalAmount.toFixed(2)}</span></div>
          {s.isContraEntrega && s.freightCost != null && s.freightCost > 0 && (
            <div className="text-[11px] text-steel mb-1">Flete del motorizado: -${s.freightCost.toFixed(2)} · debía transferir ${(s.totalAmount - s.freightCost).toFixed(2)}</div>
          )}
          {s.paymentProofAiReadAmount != null && (
            <div className="text-[11px] text-steel mb-1">El comprobante dice: <span className="font-semibold text-ink">${s.paymentProofAiReadAmount.toFixed(2)}</span></div>
          )}
          <div className="text-[11.5px] text-steel mb-2">Despachó {s.dispatchAssignedTo?.name ?? "—"} · entregó {s.deliveredBy?.name ?? "—"}</div>
          <div className="flex gap-3 mb-2.5">
            {s.paymentProofUrl && <ProofPreview url={s.paymentProofUrl} filename={s.paymentProofName ?? undefined} size={48} />}
            {s.deliveryPhotoUrl && (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={s.deliveryPhotoUrl} alt="Foto de la entrega" className="w-12 h-12 object-cover rounded border border-rule" />
            )}
          </div>

          {missingInvoice ? (
            <div className="text-[11.5px] font-semibold text-gold">Falta subir la factura para poder cerrar (pestaña Facturación).</div>
          ) : closingId === s.id ? (
            <div className="bg-cloud rounded-md p-2.5">
              <label className="flex items-center gap-2 text-[12px] font-semibold mb-2 cursor-pointer">
                <input
                  type="checkbox"
                  checked={hasDifference}
                  onChange={(e) => {
                    setHasDifference(e.target.checked);
                    const suggested = suggestedReceived(s);
                    if (e.target.checked && !received && suggested < s.totalAmount) setReceived(suggested.toFixed(2));
                  }}
                />
                Llegó menos del total — justificar la diferencia
              </label>

              {hasDifference && (
                <div className="flex flex-col gap-2 mb-2.5 border-l-2 border-gold pl-2.5">
                  <div>
                    <div className="text-[11px] text-steel mb-0.5">¿Cuánto llegó de verdad? (lo que dice el comprobante)</div>
                    <input
                      type="number"
                      min="0"
                      step="0.01"
                      placeholder="$0.00"
                      className="w-32 rounded border border-rule bg-surface px-2 py-1 text-[12.5px]"
                      value={received}
                      onChange={(e) => setReceived(e.target.value)}
                    />
                    {differenceAmount != null && (
                      <span className="ml-2 text-[12px] font-bold text-gold">Diferencia: ${differenceAmount.toFixed(2)}</span>
                    )}
                    {received.trim() !== "" && !receivedValid && (
                      <div className="text-[11px] text-red mt-0.5">Tiene que ser menor al total (${s.totalAmount.toFixed(2)}).</div>
                    )}
                  </div>
                  <div>
                    <div className="text-[11px] text-steel mb-1">¿Por qué?</div>
                    <div className="flex gap-1.5 flex-wrap">
                      {([
                        ["FLETE_MOTORIZADO", "Flete del motorizado"],
                        ["OTRO", "Otro motivo"],
                      ] as const).map(([value, label]) => (
                        <button
                          key={value}
                          type="button"
                          className={`rounded-full border px-2.5 py-1 text-[11.5px] font-semibold cursor-pointer ${reason === value ? "border-teal bg-teal text-navy" : "border-rule text-steel"}`}
                          onClick={() => setReason(value)}
                        >
                          {label}
                        </button>
                      ))}
                    </div>
                    {reason === "FLETE_MOTORIZADO" && s.paymentProofUrl && (
                      <div className="text-[11px] text-teal mt-1">✓ Respaldado con el comprobante que transfirió el motorizado (arriba).</div>
                    )}
                  </div>
                  <textarea
                    rows={2}
                    placeholder={reason === "OTRO" ? "Explica la diferencia (obligatorio)" : "Nota (opcional)"}
                    className="w-full rounded border border-rule bg-surface px-2 py-1 text-[12px]"
                    value={note}
                    onChange={(e) => setNote(e.target.value)}
                  />
                </div>
              )}

              <div className="text-[12px] font-semibold mb-2">¿Confirmás registrar esta venta como cerrada?</div>
              {error && <div className="text-red text-[11px] mb-1.5">{error}</div>}
              <div className="flex gap-2">
                <button type="button" className="flex-1 rounded border border-rule px-2.5 py-1.5 text-[11.5px] font-semibold cursor-pointer" onClick={() => setClosingId(null)}>Cancelar</button>
                <button type="button" disabled={saving || !canConfirm} className="flex-1 rounded border border-teal bg-teal px-2.5 py-1.5 text-[11.5px] font-bold text-navy cursor-pointer disabled:opacity-60" onClick={() => close(s)}>
                  {saving ? "Cerrando…" : "Sí, cerrar"}
                </button>
              </div>
            </div>
          ) : (
            <button type="button" className="flex items-center gap-1.5 text-[11.5px] font-bold border border-teal text-teal rounded px-2.5 py-1.5 cursor-pointer" onClick={() => openClose(s)}>
              <CheckCircle2 size={13} /> Cerrar venta
            </button>
          )}
        </div>
        );
      })}
    </div>
  );
}
