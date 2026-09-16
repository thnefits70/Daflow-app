"use client";

import { useEffect, useState } from "react";
import { Check } from "lucide-react";
import { CatalogCode } from "@/components/shared/CatalogCode";
import { formatDateTime } from "@/lib/formatDateTime";

type SaleItemDTO = {
  id: string;
  declaredProductName: string;
  catalogItem: { name: string; photos: string[]; justCode: string | null } | null;
  quantity: number;
};
type SaleDTO = {
  id: string;
  code: string;
  items: SaleItemDTO[];
  returnReason: string | null;
  returnedAt: string;
  returnReceivedAt: string | null;
  returnReceivedNote: string | null;
  returnReceivedBy: { name: string } | null;
  advisor: { name: string } | null;
};

async function postJson(url: string, body?: unknown) {
  const res = await fetch(url, { method: "POST", headers: { "Content-Type": "application/json" }, body: body ? JSON.stringify(body) : undefined });
  const data = await res.json().catch(() => null);
  if (!res.ok) throw new Error(data?.error ?? "Ocurrió un error.");
  return data;
}

// Confirmado 2026-09-16, pedido explícito del usuario: paso 2 y 3 del
// mismo lugar — Inventario (canReceive) verifica que el paquete devuelto
// llegó completo, y Daniel (canConfirm) aprueba con un clic — recién ahí se
// suma a INVESTOCK. El asesor ya reportó la devolución (ver
// ExternalSaleDeclareForm.tsx), esto es lo que sigue después.
export function ExternalSaleReturnInbox({ canReceive, canConfirm }: { canReceive: boolean; canConfirm: boolean }) {
  const [sales, setSales] = useState<SaleDTO[] | null>(null);
  const [notingId, setNotingId] = useState<string | null>(null);
  const [note, setNote] = useState("");
  const [saving, setSaving] = useState<string | null>(null);
  const [error, setError] = useState("");

  function load() {
    fetch("/api/external-sales/pending-returns").then((r) => r.json()).then(setSales).catch(() => setSales([]));
  }
  useEffect(load, []);

  async function markReceived(id: string) {
    setSaving(id);
    setError("");
    try {
      await postJson(`/api/external-sales/${id}/return-received`, { note: note.trim() || undefined });
      setNotingId(null);
      setNote("");
      load();
    } catch (e) {
      setError(e instanceof Error ? e.message : "No se pudo registrar la recepción.");
    } finally {
      setSaving(null);
    }
  }

  async function confirmReturn(id: string) {
    setSaving(id);
    setError("");
    try {
      await postJson(`/api/external-sales/${id}/return-confirm`);
      load();
    } catch (e) {
      setError(e instanceof Error ? e.message : "No se pudo aprobar la devolución.");
    } finally {
      setSaving(null);
    }
  }

  if (sales === null) return <div className="text-[13px] text-steel">Cargando…</div>;
  if (sales.length === 0) return <div className="text-[13px] text-steel">No hay devoluciones pendientes.</div>;

  return (
    <div className="flex flex-col gap-2.5 max-w-lg">
      {error && <div className="text-red text-[12px]">{error}</div>}
      {sales.map((s) => (
        <div key={s.id} className="bg-surface border border-rule rounded-md p-3.5">
          <div className="text-[11.5px] font-semibold mb-1">{s.code} · {s.advisor?.name ?? "—"}</div>
          <div className="flex flex-col gap-1.5 mb-2">
            {s.items.map((it) => (
              <div key={it.id} className="text-[12.5px]">
                <span className="inline-flex items-center gap-1">
                  {it.catalogItem && <CatalogCode code={it.catalogItem.justCode} />}
                  {it.catalogItem?.name ?? it.declaredProductName}
                </span>{" "}
                <span className="text-steel">· {it.quantity} un.</span>
              </div>
            ))}
          </div>
          <div className="text-[11px] text-steel mb-2">Motivo: {s.returnReason}</div>

          {s.returnReceivedAt ? (
            <div className="text-[11px] text-blue mb-2">
              Recibido físicamente por {s.returnReceivedBy?.name ?? "—"} · {formatDateTime(s.returnReceivedAt)}
              {s.returnReceivedNote ? ` — ${s.returnReceivedNote}` : ""}
            </div>
          ) : canReceive ? (
            notingId === s.id ? (
              <div className="bg-cloud rounded-md p-2.5 mb-2">
                <textarea
                  className="w-full rounded border border-rule bg-surface px-2.5 py-1.5 text-[12px] mb-2"
                  rows={2}
                  placeholder="Nota opcional — ej. llegó completo, o falta una unidad…"
                  value={note}
                  onChange={(e) => setNote(e.target.value)}
                />
                <div className="flex gap-2">
                  <button type="button" className="flex-1 rounded border border-rule px-2.5 py-1.5 text-[11.5px] font-semibold cursor-pointer" onClick={() => { setNotingId(null); setNote(""); }}>
                    Cancelar
                  </button>
                  <button
                    type="button"
                    disabled={saving === s.id}
                    className="flex-1 rounded border border-teal bg-teal px-2.5 py-1.5 text-[11.5px] font-bold text-navy cursor-pointer disabled:opacity-40"
                    onClick={() => markReceived(s.id)}
                  >
                    {saving === s.id ? "Guardando…" : "Confirmar recepción física"}
                  </button>
                </div>
              </div>
            ) : (
              <button type="button" className="flex items-center gap-1.5 text-[11.5px] font-bold border border-teal text-teal rounded px-2.5 py-1.5 cursor-pointer" onClick={() => setNotingId(s.id)}>
                <Check size={13} /> Ya llegó físicamente
              </button>
            )
          ) : (
            <div className="text-[11px] text-gold">Esperando que Inventario la reciba físicamente.</div>
          )}

          {s.returnReceivedAt && canConfirm && (
            <button
              type="button"
              disabled={saving === s.id}
              className="flex items-center gap-1.5 text-[11.5px] font-bold border border-teal bg-teal rounded px-2.5 py-1.5 cursor-pointer text-navy disabled:opacity-40"
              onClick={() => confirmReturn(s.id)}
            >
              <Check size={13} /> {saving === s.id ? "Confirmando…" : "Aprobar y sumar a INVESTOCK"}
            </button>
          )}
        </div>
      ))}
    </div>
  );
}
