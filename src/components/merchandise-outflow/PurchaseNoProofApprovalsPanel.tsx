"use client";

import { useEffect, useState } from "react";
import { AlertTriangle, CheckCircle2 } from "lucide-react";
import { CatalogCode } from "@/components/shared/CatalogCode";
import { formatDateTime } from "@/lib/formatDateTime";
import { ExpandableName } from "@/components/ui/ExpandableName";

type OtherClaim = {
  id: string;
  quantity: number;
  purchaseResolution: string | null;
  resolution: string | null;
  noProofRequestedAt: string | null;
  batch: { code: string; reason: string; createdAt: string };
};
type PreviousCredit = { id: string; amount: number; createdAt: string; reason: string; proofUrl: string | null };
type ItemDTO = {
  id: string;
  declaredName: string;
  quantity: number;
  catalogItem: { name: string; photos: string[]; justCode: string | null } | null;
  batch: { code: string };
  purchaseGestionSupplier: { id: string; name: string } | null;
  noProofRequestedBy: { name: string } | null;
  noProofRequestedAt: string;
  noProofResolution: "CREDIT_ISSUED" | "REJECTED";
  noProofAmount: number | null;
  noProofNote: string;
  expectedCreditAmount: number | null;
  inspectionReturnsToWarehouse: boolean | null;
  linkedPurchaseRequest: { requestedAt: string; unitCost: number } | null;
  otherClaims: OtherClaim[];
  previousCredits: PreviousCredit[];
  recentNoProofCount: number;
};

async function postJson(url: string, body?: unknown) {
  const res = await fetch(url, { method: "POST", headers: { "Content-Type": "application/json" }, body: body ? JSON.stringify(body) : undefined });
  const data = await res.json().catch(() => null);
  if (!res.ok) throw new Error(data?.error ?? `Falló en el servidor (código ${res.status}). No se guardó nada — intenta de nuevo.`);
  return data;
}

function money(n: number) {
  return `$${n.toFixed(2)}`;
}

const RESOLUTION_LABELS: Record<string, string> = {
  REPLACED: "mandó reemplazo",
  CREDIT_ISSUED: "dio crédito",
  REJECTED: "rechazado",
  WRITE_OFF: "dado de baja",
  SOLVED_ONSITE: "resuelto en bodega",
  ESCALATED_TO_PURCHASES: "en gestión con Compras",
};

function claimStatus(c: OtherClaim) {
  if (c.purchaseResolution) return RESOLUTION_LABELS[c.purchaseResolution] ?? c.purchaseResolution;
  if (c.resolution) return RESOLUTION_LABELS[c.resolution] ?? c.resolution;
  return "pendiente";
}

// Confirmado 2026-09-28, pedido explícito del usuario: CHEN no manda chats —
// Jariel pide cerrar reclamos SIN captura con una explicación breve, y admin
// aprueba acá. Para que no se repita lo mismo con otra mercadería, cada caso
// muestra en rojo si ese mismo producto ya tuvo otros reclamos de daño o
// créditos con ese proveedor, y cuántos pedidos sin captura lleva en 30 días.
export function PurchaseNoProofApprovalsPanel() {
  const [items, setItems] = useState<ItemDTO[] | null>(null);
  const [deciding, setDeciding] = useState<{ id: string; approve: boolean } | null>(null);
  const [note, setNote] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  function load() {
    fetch("/api/merchandise-outflow/purchase-no-proof-requests")
      .then((r) => r.json())
      .then((data) => setItems(Array.isArray(data) ? data : []))
      .catch(() => setItems([]));
  }
  useEffect(load, []);

  async function decide() {
    if (!deciding) return;
    if (!deciding.approve && !note.trim()) return;
    setSaving(true);
    setError("");
    try {
      await postJson(`/api/merchandise-outflow/items/${deciding.id}/purchase-no-proof-decide`, { approve: deciding.approve, note: note.trim() || undefined });
      setDeciding(null);
      setNote("");
      load();
    } catch (e) {
      setError(e instanceof Error ? e.message : "No se pudo guardar la decisión.");
    } finally {
      setSaving(false);
    }
  }

  if (items === null) return <div className="text-[13px] text-steel">Cargando…</div>;
  if (items.length === 0) return <div className="text-[13px] text-steel">No hay reclamos sin captura esperando tu aprobación.</div>;

  return (
    <div className="flex flex-col gap-2.5 max-w-lg">
      {items.map((item) => {
        const name = item.catalogItem?.name ?? item.declaredName;
        const supplierName = item.purchaseGestionSupplier?.name ?? "el proveedor";
        const repeated = item.otherClaims.length > 0 || item.previousCredits.length > 0;
        return (
          <div key={item.id} className="bg-surface border border-rule rounded-md p-3.5">
            <div className="flex items-center gap-3 mb-2.5">
              {item.catalogItem?.photos[0] && (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={item.catalogItem.photos[0]} alt={name} className="w-12 h-12 object-cover rounded border border-rule shrink-0" />
              )}
              <div className="flex-1 min-w-0">
                <div className="text-[13px] font-semibold flex items-center gap-1.5 min-w-0">
                  {item.catalogItem && <CatalogCode code={item.catalogItem.justCode} />}
                  <ExpandableName text={name} />
                </div>
                <div className="text-[11px] text-steel">{item.quantity} un. · {item.batch.code} · {supplierName}</div>
              </div>
            </div>

            <div className="bg-cloud rounded p-2.5 mb-2.5 text-[12px]">
              <div className="font-semibold mb-0.5">
                {item.noProofResolution === "CREDIT_ISSUED" ? `${supplierName} dio crédito de ${money(item.noProofAmount ?? 0)}` : `${supplierName} rechazó el reclamo`}
                {item.noProofResolution === "CREDIT_ISSUED" && item.expectedCreditAmount != null && (
                  <span className="font-normal text-steel"> · se pagó {money(item.expectedCreditAmount)}</span>
                )}
              </div>
              <span className="font-semibold">{item.noProofRequestedBy?.name ?? "—"}</span> ({formatDateTime(item.noProofRequestedAt)}): {item.noProofNote}
              {item.noProofResolution === "REJECTED" && item.inspectionReturnsToWarehouse !== null && (
                <div className="mt-1 text-steel">
                  Ya la revisó: {item.inspectionReturnsToWarehouse ? "la devuelve a bodega" : "se queda con el proveedor"}.
                </div>
              )}
            </div>

            {repeated ? (
              <div className="bg-red/10 border border-red/40 rounded-md p-2.5 mb-2.5 text-[11.5px]">
                <div className="flex items-center gap-1.5 font-semibold text-red mb-1">
                  <AlertTriangle size={13} /> Este producto ya tuvo otros reclamos con {supplierName}
                </div>
                {item.otherClaims.length > 0 && (
                  <ul className="list-disc pl-4 flex flex-col gap-0.5 mb-1">
                    {item.otherClaims.map((c) => (
                      <li key={c.id}>
                        {c.batch.code} · {formatDateTime(c.batch.createdAt)} · {c.quantity} un. · {claimStatus(c)}
                        {c.noProofRequestedAt && " · sin captura"}
                      </li>
                    ))}
                  </ul>
                )}
                {item.previousCredits.length > 0 && (
                  <>
                    <div className="font-semibold mt-1">Créditos que ya se dieron por este producto:</div>
                    <ul className="list-disc pl-4 flex flex-col gap-0.5">
                      {item.previousCredits.map((c) => (
                        <li key={c.id}>
                          {money(c.amount)} · {formatDateTime(c.createdAt)}
                          {!c.proofUrl && " · sin captura"}
                        </li>
                      ))}
                    </ul>
                  </>
                )}
              </div>
            ) : (
              <div className="flex items-center gap-1.5 text-[11.5px] text-green font-semibold mb-2.5">
                <CheckCircle2 size={13} /> Ningún otro reclamo ni crédito de este producto con {supplierName}.
              </div>
            )}

            {item.recentNoProofCount > 0 && (
              <div className="text-[11.5px] mb-2.5" style={{ color: "var(--color-gold)" }}>
                {supplierName} lleva {item.recentNoProofCount} pedido{item.recentNoProofCount === 1 ? "" : "s"} más sin captura en los últimos 30 días.
              </div>
            )}

            {deciding?.id === item.id ? (
              <div className="bg-cloud rounded-md p-2.5">
                <div className="text-[12px] font-semibold mb-1.5">{deciding.approve ? "Aprobar — se registra ya" : "Devolver a Compras"}</div>
                <textarea
                  className="w-full rounded border border-rule bg-surface px-2.5 py-1.5 text-[12px] mb-2"
                  rows={2}
                  value={note}
                  onChange={(e) => setNote(e.target.value)}
                  placeholder={deciding.approve ? "Nota (opcional)…" : "¿Por qué lo devuelves?"}
                />
                {error && <div className="text-red text-[11px] mb-1.5">{error}</div>}
                <div className="flex gap-2">
                  <button type="button" className="flex-1 rounded border border-rule px-2.5 py-1.5 text-[11.5px] font-semibold cursor-pointer" onClick={() => { setDeciding(null); setNote(""); setError(""); }}>
                    Cancelar
                  </button>
                  <button
                    type="button"
                    disabled={saving || (!deciding.approve && !note.trim())}
                    className="flex-1 rounded border border-teal bg-teal px-2.5 py-1.5 text-[11.5px] font-bold text-navy cursor-pointer disabled:opacity-40"
                    onClick={decide}
                  >
                    {saving ? "Guardando…" : "Confirmar"}
                  </button>
                </div>
              </div>
            ) : (
              <div className="flex gap-1.5 flex-wrap">
                <button type="button" className="text-[11.5px] font-semibold border border-green/40 text-green rounded-full px-2.5 py-1 cursor-pointer" onClick={() => setDeciding({ id: item.id, approve: true })}>
                  Aprobar
                </button>
                <button type="button" className="text-[11.5px] font-semibold border border-red/40 text-red rounded-full px-2.5 py-1 cursor-pointer" onClick={() => setDeciding({ id: item.id, approve: false })}>
                  Devolver
                </button>
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}
