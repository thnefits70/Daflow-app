"use client";

import { useEffect, useState } from "react";
import { CatalogCode } from "@/components/shared/CatalogCode";
import { formatDateTime } from "@/lib/formatDateTime";

type ItemDTO = {
  id: string;
  declaredName: string;
  quantity: number;
  catalogItem: { name: string; photos: string[]; justCode: string | null } | null;
  batch: { code: string };
  purchaseGestionSupplier: { name: string } | null;
  purchaseNoMatchNote: string | null;
  purchaseNoMatchReportedAt: string;
  purchaseNoMatchReportedBy: { name: string } | null;
};

type Decision = "DATA_CORRECTED" | "AUTHORIZED" | "REJECTED";

async function postJson(url: string, body?: unknown) {
  const res = await fetch(url, { method: "POST", headers: { "Content-Type": "application/json" }, body: body ? JSON.stringify(body) : undefined });
  const data = await res.json().catch(() => null);
  if (!res.ok) throw new Error(data?.error ?? "Ocurrió un error.");
  return data;
}

function itemName(item: ItemDTO) {
  return item.catalogItem?.name ?? item.declaredName;
}

const DECISION_LABELS: Record<Decision, string> = {
  DATA_CORRECTED: "Corregí el dato — que vuelva a intentar",
  AUTHORIZED: "Autorizo seguir sin compra vinculada",
  REJECTED: "No se puede sustentar — rechazar reclamo",
};

// Confirmado 2026-09-17, pedido explícito del usuario: nunca se deja un
// reclamo de deterioro sin trámite solo porque no se encontró la compra que
// lo respalda — admin decide acá una de tres (ver purchase-exception-decide/
// route.ts). Company-wide, exclusivo de admin.
export function PurchaseDeteriorExceptionsPanel() {
  const [items, setItems] = useState<ItemDTO[] | null>(null);
  const [deciding, setDeciding] = useState<{ id: string; decision: Decision } | null>(null);
  const [note, setNote] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  function load() {
    fetch("/api/merchandise-outflow/purchase-exceptions")
      .then((r) => r.json())
      .then((data) => setItems(Array.isArray(data) ? data : []))
      .catch(() => setItems([]));
  }
  useEffect(load, []);

  async function decide() {
    if (!deciding || !note.trim()) return;
    setSaving(true);
    setError("");
    try {
      await postJson(`/api/merchandise-outflow/items/${deciding.id}/purchase-exception-decide`, { decision: deciding.decision, note: note.trim() });
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
  if (items.length === 0) return <div className="text-[13px] text-steel">No hay reclamos sin respaldo esperando tu decisión.</div>;

  return (
    <div className="flex flex-col gap-2.5 max-w-lg">
      {items.map((item) => (
        <div key={item.id} className="bg-red/5 border border-red/30 rounded-md p-3.5">
          <div className="flex items-center gap-3 mb-2.5">
            {item.catalogItem?.photos[0] && (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={item.catalogItem.photos[0]} alt={itemName(item)} className="w-12 h-12 object-cover rounded border border-rule shrink-0" />
            )}
            <div className="flex-1 min-w-0">
              <div className="text-[13px] font-semibold flex items-center gap-1.5 min-w-0">
                {item.catalogItem && <CatalogCode code={item.catalogItem.justCode} />}
                <span className="truncate">{itemName(item)}</span>
              </div>
              <div className="text-[11px] text-steel">{item.quantity} un. · {item.batch.code} · proveedor elegido: {item.purchaseGestionSupplier?.name ?? "—"}</div>
            </div>
          </div>

          <div className="bg-surface border border-rule rounded p-2.5 mb-2.5 text-[12px]">
            <span className="font-semibold">{item.purchaseNoMatchReportedBy?.name ?? "—"}</span> reportó ({formatDateTime(item.purchaseNoMatchReportedAt)}): {item.purchaseNoMatchNote}
          </div>

          {deciding?.id === item.id ? (
            <div className="bg-cloud rounded-md p-2.5">
              <div className="text-[12px] font-semibold mb-1.5">{DECISION_LABELS[deciding.decision]}</div>
              <textarea className="w-full rounded border border-rule bg-surface px-2.5 py-1.5 text-[12px] mb-2" rows={2} value={note} onChange={(e) => setNote(e.target.value)} placeholder="Explica tu decisión…" />
              {error && <div className="text-red text-[11px] mb-1.5">{error}</div>}
              <div className="flex gap-2">
                <button type="button" className="flex-1 rounded border border-rule px-2.5 py-1.5 text-[11.5px] font-semibold cursor-pointer" onClick={() => { setDeciding(null); setNote(""); setError(""); }}>
                  Cancelar
                </button>
                <button type="button" disabled={saving || !note.trim()} className="flex-1 rounded border border-teal bg-teal px-2.5 py-1.5 text-[11.5px] font-bold text-navy cursor-pointer disabled:opacity-40" onClick={decide}>
                  {saving ? "Guardando…" : "Confirmar"}
                </button>
              </div>
            </div>
          ) : (
            <div className="flex gap-1.5 flex-wrap">
              <button type="button" className="text-[11.5px] font-semibold border border-blue/40 text-blue rounded-full px-2.5 py-1 cursor-pointer" onClick={() => setDeciding({ id: item.id, decision: "DATA_CORRECTED" })}>
                Corregí el dato
              </button>
              <button type="button" className="text-[11.5px] font-semibold border border-green/40 text-green rounded-full px-2.5 py-1 cursor-pointer" onClick={() => setDeciding({ id: item.id, decision: "AUTHORIZED" })}>
                Autorizar sin respaldo
              </button>
              <button type="button" className="text-[11.5px] font-semibold border border-red/40 text-red rounded-full px-2.5 py-1 cursor-pointer" onClick={() => setDeciding({ id: item.id, decision: "REJECTED" })}>
                Rechazar reclamo
              </button>
            </div>
          )}
        </div>
      ))}
    </div>
  );
}
