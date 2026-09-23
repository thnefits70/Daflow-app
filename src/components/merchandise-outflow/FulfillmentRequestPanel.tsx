"use client";

import { useEffect, useState } from "react";
import { RocketRequestPanel } from "./RocketRequestPanel";
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

  async function showLot(id: string) {
    const detail = await fetch(`/api/fulfillment-lots/${id}`).then((r) => (r.ok ? r.json() : null));
    if (detail) {
      setLot(detail);
      setBatch(null);
    }
  }

  async function showBatch(id: string) {
    const detail = await fetch(`/api/fulfillment-requests/${id}`).then((r) => (r.ok ? r.json() : null));
    if (detail) setBatch(detail);
  }

  function loadLots(openId: string | null) {
    fetch("/api/fulfillment-lots")
      .then((r) => (r.ok ? r.json() : []))
      .then((list: LotListItem[]) => {
        setLots(list);
        // Al entrar se abre solo el corte más reciente (el que está en
        // preparación, o el último enviado).
        const target = openId ?? list[0]?.id ?? null;
        if (target) showLot(target);
        else setLot(null);
      })
      .catch(() => setLots([]));
  }
  // eslint-disable-next-line react-hooks/exhaustive-deps -- solo al montar
  useEffect(() => loadLots(null), []);

  return (
    <div>
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
          <RocketRequestPanel onApplied={() => loadLots(null)} />
        </div>
      )}

      <LotHistoryList lots={lots} onView={showLot} />
    </div>
  );
}
