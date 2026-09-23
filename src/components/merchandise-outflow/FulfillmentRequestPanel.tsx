"use client";

import { useEffect, useState } from "react";
import { ChevronDown, ChevronUp } from "lucide-react";
import { RocketRequestPanel } from "./RocketRequestPanel";
import { DropiRequestPanel } from "./DropiRequestPanel";
import { DropiGuidesPanel } from "./DropiGuidesPanel";
import { CompiledResult, DayResult, FulfillmentHistoryList, type CompiledBatch, type CompiledDay, type BatchListItem } from "./fulfillmentRequestShared";

// Ecuador no tiene horario de verano: siempre UTC-5.
function ecuadorToday() {
  return new Date(Date.now() - 5 * 60 * 60 * 1000).toISOString().slice(0, 10);
}

export function FulfillmentRequestPanel({ canSubmit }: { canSubmit: boolean }) {
  const [batch, setBatch] = useState<CompiledBatch | null>(null);
  const [day, setDay] = useState<CompiledDay | null>(null);
  const [history, setHistory] = useState<BatchListItem[]>([]);
  const [showPhotoFlow, setShowPhotoFlow] = useState(false);

  async function showDay(date: string) {
    const detail = await fetch(`/api/fulfillment-requests/day?date=${date}`).then((r) => (r.ok ? r.json() : null));
    if (detail) {
      setDay(detail);
      setBatch(null);
    }
  }

  async function showBatch(id: string) {
    const detail = await fetch(`/api/fulfillment-requests/${id}`).then((r) => (r.ok ? r.json() : null));
    if (detail) setBatch(detail);
  }

  function loadHistory(openToday: boolean) {
    fetch("/api/fulfillment-requests")
      .then((r) => (r.ok ? r.json() : []))
      .then((list: BatchListItem[]) => {
        setHistory(list);
        // Al entrar, el lote de hoy (si ya hay algo subido) se muestra solo.
        if (openToday && list[0]?.day === ecuadorToday()) showDay(list[0].day);
      })
      .catch(() => setHistory([]));
  }
  // eslint-disable-next-line react-hooks/exhaustive-deps -- solo al montar
  useEffect(() => loadHistory(true), []);

  function handleApplied(batchId: string) {
    loadHistory(false);
    showDay(ecuadorToday()).then(() => showBatch(batchId));
  }

  return (
    <div>
      {day && <DayResult key={day.day + day.batches.length} data={day} onOpenBatch={showBatch} />}
      {batch && (
        <div className="-mt-3 mb-5">
          <div className="flex items-center justify-between mb-1">
            <span className="text-[11px] text-steel">Detalle de una subida del lote:</span>
            <button type="button" className="text-[11px] text-steel hover:text-teal cursor-pointer" onClick={() => setBatch(null)}>
              Cerrar
            </button>
          </div>
          <CompiledResult key={batch.id} batch={batch} canEditVariants={canSubmit} />
        </div>
      )}

      {canSubmit && (
        <div className="flex flex-col gap-6 mb-5">
          <DropiGuidesPanel onApplied={handleApplied} />
          <RocketRequestPanel onApplied={handleApplied} />
          <div>
            <button type="button" className="flex items-center gap-1 text-[11px] font-semibold text-steel hover:text-teal cursor-pointer" onClick={() => setShowPhotoFlow((s) => !s)}>
              {showPhotoFlow ? <ChevronUp size={12} /> : <ChevronDown size={12} />} ¿No tienes el PDF? Subir captura del manifiesto (método anterior)
            </button>
            {showPhotoFlow && (
              <div className="mt-3">
                <DropiRequestPanel onApplied={handleApplied} />
              </div>
            )}
          </div>
        </div>
      )}

      <FulfillmentHistoryList history={history} onViewDay={showDay} />
    </div>
  );
}
