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
  isContraEntrega: boolean;
  freightCost: number | null;
  paymentProofUrl: string;
  paymentProofName: string | null;
  paymentProofUploadedAt: string | null;
  paymentProofAiReadAmount: number | null;
  paymentProofAiMatches: boolean | null;
  paymentOverrideNote: string | null;
  client: { name: string; idType: "RUC" | "CEDULA" | null; idNumber: string | null; phone: string; email: string | null } | null;
  advisor: { name: string } | null;
};

async function postJson(url: string, body?: unknown) {
  const res = await fetch(url, { method: "POST", headers: body ? { "Content-Type": "application/json" } : undefined, body: body ? JSON.stringify(body) : undefined });
  const data = await res.json().catch(() => null);
  if (!res.ok) throw new Error(data?.error ?? "Ocurrió un error.");
  return data;
}

export function ExternalSalePaymentConfirmInbox() {
  const [sales, setSales] = useState<SaleDTO[] | null>(null);
  const [confirmingId, setConfirmingId] = useState<string | null>(null);
  const [explainingId, setExplainingId] = useState<string | null>(null);
  const [amountNote, setAmountNote] = useState("");
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

  // Confirmado 2026-09-18, pedido explícito del usuario: cuando la IA no
  // verifica el monto, admin puede escribir él mismo la explicación acá
  // como respaldo (lo normal es que la escriba el asesor, ver el mismo
  // formulario en ExternalSaleDeclareForm) — mismo endpoint para los dos.
  async function saveAmountNote(id: string) {
    setSaving(true);
    setError("");
    try {
      await postJson(`/api/external-sales/${id}/payment-amount-note`, { note: amountNote });
      setExplainingId(null);
      setAmountNote("");
      load();
    } catch (e) {
      setError(e instanceof Error ? e.message : "No se pudo guardar la explicación.");
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
          {/* Confirmado 2026-09-18, pedido explícito del usuario: con
              recaudo el motorizado cobra el total al cliente y se queda el
              flete él mismo, así que a la cuenta solo llega el resto. Sin
              recaudo el cliente transfiere directo el total completo — nadie
              descuenta el flete en el camino, así que hay que esperar el
              total y pagarle el flete al motorizado aparte (ver Caja Chica). */}
          {s.isContraEntrega && s.freightCost != null && (
            <div className="text-[11px] text-steel mb-1.5">
              Flete: -${s.freightCost.toFixed(2)} · <span className="font-bold text-ink">Monto esperado a transferir: ${(s.totalAmount - s.freightCost).toFixed(2)}</span>
            </div>
          )}
          {!s.isContraEntrega && (
            <div className="text-[11px] text-steel mb-1.5">
              <span className="font-bold text-ink">Monto esperado a transferir: ${s.totalAmount.toFixed(2)}</span> (sin recaudo — el cliente paga el total completo)
              {s.freightCost != null && <> · el flete (${s.freightCost.toFixed(2)}) se le paga al motorizado aparte, desde Caja Chica</>}
            </div>
          )}
          <div className="text-[11px] text-steel mb-1.5">
            Comprobante subido: {s.paymentProofUploadedAt ? formatDateTime(s.paymentProofUploadedAt) : "—"}
          </div>
          <div className="text-[11px] text-steel mb-1.5">
            Cliente: {s.client ? `${s.client.name} · ${s.client.idNumber ? `${s.client.idType === "RUC" ? "RUC" : "Cédula"}: ${s.client.idNumber} · ` : ""}Cel: ${s.client.phone}${s.client.email ? ` · Correo: ${s.client.email}` : ""}` : "—"}
          </div>
          <ProofPreview url={s.paymentProofUrl} filename={s.paymentProofName ?? undefined} size={56} />

          {/* Confirmado 2026-09-18, pedido explícito del usuario: apenas
              Marcos sube el comprobante, la IA ya lo leyó y comparó contra lo
              esperado (ver payment-proof/route.ts) — acá solo se muestra el
              resultado, nunca se vuelve a llamar a la IA. Si no coincide, el
              botón "Confirmar recibido" queda bloqueado hasta que exista una
              explicación (normalmente la escribe el asesor, ver
              ExternalSaleDeclareForm — admin también puede escribirla acá
              como respaldo). */}
          {s.paymentProofAiMatches === true && (
            <div className="flex items-center gap-1 text-teal text-[11px] font-semibold mt-1.5">
              <CheckCircle2 size={12} /> La IA verificó: el comprobante coincide con lo esperado.
            </div>
          )}
          {s.paymentProofAiMatches !== true && (
            <div className={`text-[11px] font-semibold mt-1.5 ${s.paymentProofAiMatches === false ? "text-red" : "text-gold"}`}>
              {s.paymentProofAiMatches === false
                ? `⚠ La IA leyó $${s.paymentProofAiReadAmount?.toFixed(2)} en el comprobante — no coincide exactamente con lo esperado.`
                : "⚠ La IA no pudo leer el comprobante con claridad."}
            </div>
          )}
          {s.paymentProofAiMatches !== true && s.paymentOverrideNote && (
            <div className="text-[11px] text-steel bg-cloud rounded px-2 py-1.5 mt-1">
              <span className="font-semibold text-ink">Explicación:</span> {s.paymentOverrideNote}
            </div>
          )}
          {s.paymentProofAiMatches !== true && !s.paymentOverrideNote && (
            explainingId === s.id ? (
              <div className="bg-cloud rounded-md p-2.5 mt-1.5">
                <textarea
                  rows={2}
                  autoFocus
                  placeholder="¿Por qué está bien confirmar igual? (ej: el cliente transfirió de más por error)…"
                  className="w-full rounded border border-rule bg-surface px-2.5 py-1.5 text-[11.5px] resize-none"
                  value={amountNote}
                  onChange={(e) => setAmountNote(e.target.value)}
                />
                {error && <div className="text-red text-[11px] mt-1">{error}</div>}
                <div className="flex gap-2 mt-1.5">
                  <button type="button" className="flex-1 rounded border border-rule px-2.5 py-1.5 text-[11px] font-semibold cursor-pointer" onClick={() => { setExplainingId(null); setAmountNote(""); }}>Cancelar</button>
                  <button type="button" disabled={saving || amountNote.trim().length < 3} className="flex-1 rounded border border-teal bg-teal px-2.5 py-1.5 text-[11px] font-bold text-navy cursor-pointer disabled:opacity-60" onClick={() => saveAmountNote(s.id)}>
                    {saving ? "Guardando…" : "Guardar explicación"}
                  </button>
                </div>
              </div>
            ) : (
              <button type="button" className="text-[10.5px] font-semibold text-blue cursor-pointer mt-1" onClick={() => { setExplainingId(s.id); setAmountNote(""); setError(""); }}>
                Explicar por qué está bien confirmar igual
              </button>
            )
          )}

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
              <button
                type="button"
                disabled={s.paymentProofAiMatches !== true && !s.paymentOverrideNote}
                title={s.paymentProofAiMatches !== true && !s.paymentOverrideNote ? "Primero hace falta una explicación de por qué el monto no coincide" : undefined}
                className="flex items-center gap-1.5 text-[11.5px] font-bold border border-teal text-teal rounded px-2.5 py-1.5 cursor-pointer disabled:opacity-40 disabled:cursor-not-allowed"
                onClick={() => setConfirmingId(s.id)}
              >
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
