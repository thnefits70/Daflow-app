"use client";

import { useEffect, useState } from "react";
import { PackageMinus } from "lucide-react";
import { OUTFLOW_REASON_LABELS } from "@/lib/merchandiseOutflowLabels";

type ItemDTO = {
  id: string;
  declaredName: string;
  quantity: number;
  catalogItem: { name: string; photos: string[] } | null;
  damageReason: { name: string } | null;
  damageReasonOther: string | null;
};
type BatchDTO = { id: string; code: string; reason: keyof typeof OUTFLOW_REASON_LABELS; submittedAt: string | null; createdBy: { name: string } | null; items: ItemDTO[] };

async function postJson(url: string) {
  const res = await fetch(url, { method: "POST" });
  const data = await res.json().catch(() => null);
  if (!res.ok) throw new Error(data?.error ?? "Ocurrió un error.");
  return data;
}

function itemName(item: ItemDTO) {
  return item.catalogItem?.name ?? item.declaredName;
}

// Todo lo que está listo para dar de baja en Just, sin importar el motivo —
// un solo lugar en vez de saltar entre despacho/garantía/deterioro/compras
// personales (pedido explícito del usuario).
export function WriteOffQueue({ canAct }: { canAct: boolean }) {
  const [batches, setBatches] = useState<BatchDTO[] | null>(null);
  const [confirmingId, setConfirmingId] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  function load() {
    fetch("/api/merchandise-outflow/writeoff-queue")
      .then((r) => r.json())
      // Fix confirmado 2026-08-26: un 403 (sin canViewMerchandiseOutflow)
      // llega igual como JSON ({error: "..."}) — sin este chequeo,
      // setBatches recibía un objeto en vez de un arreglo y el .map de
      // abajo crasheaba la pantalla en vez de mostrar un estado vacío.
      .then((data) => setBatches(Array.isArray(data) ? data : []))
      .catch(() => setBatches([]));
  }
  useEffect(load, []);

  async function confirm(id: string) {
    setSaving(true);
    setError("");
    try {
      await postJson(`/api/merchandise-outflow/batches/${id}/just-writeoff`);
      setConfirmingId(null);
      load();
    } catch (e) {
      setError(e instanceof Error ? e.message : "No se pudo confirmar.");
    } finally {
      setSaving(false);
    }
  }

  if (batches === null) return <div className="text-[13px] text-steel">Cargando…</div>;
  if (batches.length === 0) return <div className="text-[13px] text-steel">No hay nada pendiente de dar de baja en Just.</div>;

  return (
    <div className="flex flex-col gap-2.5 max-w-lg">
      {batches.map((batch) => (
        <div key={batch.id} className="bg-surface border border-rule rounded-md p-3.5">
          <div className="flex items-center gap-2 mb-2">
            <span className="font-mono text-[11px] font-bold text-teal">{batch.code}</span>
            <span className="text-[10px] font-semibold uppercase tracking-wide text-steel bg-cloud rounded-full px-2 py-0.5">{OUTFLOW_REASON_LABELS[batch.reason] ?? batch.reason}</span>
          </div>
          <div className="flex flex-col gap-1 mb-2.5">
            {batch.items.map((item) => (
              <div key={item.id} className="text-[12.5px] flex items-center justify-between gap-2">
                <span className="truncate">{itemName(item)}</span>
                <span className="font-mono text-[11px] text-steel shrink-0">{item.quantity} un.</span>
              </div>
            ))}
          </div>
          <div className="text-[10.5px] text-steel mb-2.5">Registrado por {batch.createdBy?.name ?? "—"}</div>

          {!canAct ? (
            <div className="text-[11.5px] text-steel">Solo Daniel puede confirmar la baja en Just.</div>
          ) : confirmingId === batch.id ? (
            <div className="bg-cloud rounded-md p-2.5">
              <div className="text-[12px] font-semibold mb-2">¿Ya diste de baja esta mercadería en Just?</div>
              {error && <div className="text-red text-[11px] mb-1.5">{error}</div>}
              <div className="flex gap-2">
                <button type="button" className="flex-1 rounded border border-rule px-2.5 py-1.5 text-[11.5px] font-semibold cursor-pointer" onClick={() => setConfirmingId(null)}>Cancelar</button>
                <button type="button" disabled={saving} className="flex-1 rounded border border-teal bg-teal px-2.5 py-1.5 text-[11.5px] font-bold text-navy cursor-pointer disabled:opacity-60" onClick={() => confirm(batch.id)}>
                  {saving ? "Confirmando…" : "Sí, ya lo hice"}
                </button>
              </div>
            </div>
          ) : (
            <button type="button" className="flex items-center gap-1.5 text-[11.5px] font-bold border border-teal text-teal rounded px-2.5 py-1.5 cursor-pointer" onClick={() => setConfirmingId(batch.id)}>
              <PackageMinus size={13} /> Dar de baja en Just
            </button>
          )}
        </div>
      ))}
    </div>
  );
}
