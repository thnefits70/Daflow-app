"use client";

import { useEffect, useState } from "react";
import { DropiGuidesPanel } from "./DropiGuidesPanel";
import { CompiledResult, type CompiledBatch } from "./fulfillmentRequestShared";
import { LotHistoryList, LotView, type CompiledLot, type LotListItem } from "./LotView";

// Confirmado 2026-09-23 (diseño acordado con el usuario): todo se organiza
// por CORTE — Yair sube los PDF de guías de ese horario, revisa y envía el
// corte a Inventario con doble confirmación. Se quitó la subida por foto
// del manifiesto: el usuario pidió que no quede ningún camino alterno.
export function FulfillmentRequestPanel({ canSubmit }: { canSubmit: boolean }) {
  const [lot, setLot] = useState<CompiledLot | null>(null);
  const [batch, setBatch] = useState<CompiledBatch | null>(null);
  const [lots, setLots] = useState<LotListItem[]>([]);
  // Antes, si la lista o el corte fallaban, la pantalla quedaba en blanco
  // sin decir nada (reporte de Daniel 2026-09-24): ahora se ve si está
  // cargando, si no hay cortes o el error exacto del servidor.
  const [loading, setLoading] = useState(true);
  const [loadErr, setLoadErr] = useState("");

  async function readError(r: Response) {
    const json = await r.json().catch(() => null);
    return `${json?.error ?? "Error del servidor"} (código ${r.status})`;
  }

  async function showLot(id: string) {
    const r = await fetch(`/api/fulfillment-lots/${id}`).catch(() => null);
    if (!r || !r.ok) {
      setLoadErr(`No se pudo abrir el corte: ${r ? await readError(r) : "sin conexión"}.`);
      return;
    }
    setLot(await r.json());
    setBatch(null);
  }

  async function showBatch(id: string) {
    const detail = await fetch(`/api/fulfillment-requests/${id}`).then((r) => (r.ok ? r.json() : null));
    if (detail) setBatch(detail);
  }

  function loadLots(openId: string | null) {
    fetch("/api/fulfillment-lots")
      .then((r) => afterList(r, openId))
      .catch(() => setLoadErr("No se pudo cargar los cortes: sin conexión."))
      .finally(() => setLoading(false));
  }

  async function afterList(r: Response, openId: string | null) {
    setLoadErr("");
    if (!r.ok) {
      setLoadErr(`No se pudo cargar los cortes: ${await readError(r)}.`);
      return;
    }
    const list: LotListItem[] = await r.json();
    setLots(list);
    // Al entrar se abre solo un corte. Fulfillment ve el más reciente (el
    // que está armando). Inventario abre primero el enviado que falta sacar
    // — si no, el corte en preparación de Yair tapaba el escáner (reporte
    // de Daniel 2026-09-24).
    const forInventory = list.find((l) => l.status === "SENT") ?? list.find((l) => l.status !== "DRAFT");
    const target = openId ?? (canSubmit ? list[0] : forInventory ?? list[0])?.id ?? null;
    if (target) await showLot(target);
    else setLot(null);
  }
  // eslint-disable-next-line react-hooks/exhaustive-deps -- solo al montar
  useEffect(() => loadLots(null), []);

  return (
    <div>
      {loading && <div className="text-[12px] text-steel mb-4">Cargando cortes…</div>}
      {loadErr && (
        <div className="text-[12px] text-red bg-red/10 border border-red/30 rounded-md p-2.5 mb-4">
          {loadErr}{" "}
          <button type="button" className="underline font-semibold cursor-pointer" onClick={() => loadLots(lot?.id ?? null)}>
            Reintentar
          </button>
        </div>
      )}
      {!loading && !loadErr && lots.length === 0 && (
        <div className="text-[12px] text-steel bg-cloud rounded-md p-3 mb-4">
          Todavía no hay cortes. Aparecen aquí cuando Yair sube las guías; para escanear, el corte tiene que estar enviado a Inventario.
        </div>
      )}
      {lot && <LotView key={`${lot.id}-${lot.status}-${lot.batches.length}`} lot={lot} canSubmit={canSubmit} onOpenBatch={showBatch} onChanged={() => loadLots(lot.id)} />}
      {batch && (
        <div className="-mt-3 mb-5">
          <div className="flex items-center justify-between mb-1">
            <span className="text-[11px] text-steel">Detalle de una subida del corte:</span>
            <button type="button" className="text-[11px] text-steel hover:text-teal cursor-pointer" onClick={() => setBatch(null)}>
              Cerrar
            </button>
          </div>
          <CompiledResult key={batch.id} batch={batch} canEditVariants={canSubmit && lot?.status === "DRAFT"} />
        </div>
      )}

      {canSubmit && (
        <div className="flex flex-col gap-6 mb-5">
          <DropiGuidesPanel onApplied={(lotId) => loadLots(lotId)} />
        </div>
      )}

      <LotHistoryList lots={lots} onView={showLot} />
    </div>
  );
}
