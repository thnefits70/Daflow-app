"use client";

import { useEffect, useState } from "react";
import { DropiGuidesPanel } from "./DropiGuidesPanel";
import { CompiledResult, type CompiledBatch } from "./fulfillmentRequestShared";
import { fmtDay, LotHistoryList, LotView, type CompiledLot, type LotListItem } from "./LotView";

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
  // Aviso corto cuando un corte se acaba de cerrar y se fue al historial.
  const [justClosed, setJustClosed] = useState("");

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
    setJustClosed("");
  }

  async function showBatch(id: string) {
    const detail = await fetch(`/api/fulfillment-requests/${id}`).then((r) => (r.ok ? r.json() : null));
    if (detail) setBatch(detail);
  }

  // prevStatus: estado que tenía el corte abierto antes del cambio. Si pasó
  // a CERRADO en ese momento, se va al historial enseguida (pedido del
  // usuario 2026-09-26) en vez de quedarse desplegado.
  function loadLots(openId: string | null, prevStatus?: string) {
    fetch("/api/fulfillment-lots")
      .then((r) => afterList(r, openId, prevStatus))
      .catch(() => setLoadErr("No se pudo cargar los cortes: sin conexión."))
      .finally(() => setLoading(false));
  }

  async function afterList(r: Response, openId: string | null, prevStatus?: string) {
    setLoadErr("");
    if (!r.ok) {
      setLoadErr(`No se pudo cargar los cortes: ${await readError(r)}.`);
      return;
    }
    const list: LotListItem[] = await r.json();
    setLots(list);
    // Al entrar se abre solo un corte con trabajo pendiente. Fulfillment ve
    // el que está armando o el enviado. Inventario abre el enviado que falta
    // sacar — si no, el corte en preparación de Yair tapaba el escáner
    // (reporte de Daniel 2026-09-24). Los cerrados quedan solo en el
    // historial (pedido del usuario 2026-09-26).
    const opened = openId ? list.find((l) => l.id === openId) : undefined;
    if (opened?.status === "CLOSED" && prevStatus && prevStatus !== "CLOSED") {
      setJustClosed(`Corte ${opened.corte} cerrado — ya se descontó del Kardex lo que salió. Quedó guardado en el historial.`);
      openId = null;
    }
    const pending = canSubmit ? list.find((l) => l.status !== "CLOSED") : list.find((l) => l.status === "SENT");
    const target = openId ?? pending?.id ?? null;
    if (target) await showLot(target);
    else setLot(null);
  }
  // eslint-disable-next-line react-hooks/exhaustive-deps -- solo al montar
  useEffect(() => loadLots(null), []);

  // Inventario solo trabaja cortes ya enviados; Yair también ve los que arma.
  const otherPending = lots.filter((l) => (canSubmit ? l.status !== "CLOSED" : l.status === "SENT") && l.id !== lot?.id);

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
      {otherPending.length > 0 && (
        <div className="flex flex-wrap items-center gap-1.5 mb-3">
          <span className="text-[11px] font-semibold text-steel">Otros cortes pendientes:</span>
          {otherPending.map((l) => {
            // Rojo: productos sin escanear o con menos de lo pedido. Amarillo:
            // falta asignar algún bloque. Si pasan las dos, manda el rojo.
            const tone = l.unscanned > 0 ? "border-red/60 bg-red/10 text-red hover:border-red" : l.unassignedBlocks > 0 ? "border-gold/60 bg-gold/15 text-gold hover:border-gold" : "border-teal/50 text-teal hover:border-teal";
            const notes = [l.unscanned > 0 && `${l.unscanned} ${l.unscanned === 1 ? "producto" : "productos"} sin escanear completo`, l.unassignedBlocks > 0 && `${l.unassignedBlocks} ${l.unassignedBlocks === 1 ? "bloque" : "bloques"} sin asignar`].filter(Boolean);
            return (
              <button key={l.id} type="button" className={`text-[10.5px] rounded-full border px-2 py-0.5 cursor-pointer ${tone}`} onClick={() => showLot(l.id)}>
                {fmtDay(l.day)} · Corte {l.corte} · {l.status === "DRAFT" ? "En preparación" : "Enviado"} · {l.guides} guías
                {notes.length > 0 && <span className="font-semibold"> · {notes.join(" · ")}</span>}
              </button>
            );
          })}
        </div>
      )}
      {justClosed && (
        <div className="text-[12px] text-teal bg-teal/10 border border-teal/30 rounded-md p-2.5 mb-4">{justClosed}</div>
      )}
      {!loading && !loadErr && lots.length > 0 && !lot && (
        <div className="text-[12px] text-steel bg-cloud rounded-md p-3 mb-4">
          No hay cortes pendientes. Los cortes cerrados están en el historial de abajo.
        </div>
      )}
      {lot?.status === "CLOSED" && (
        <div className="flex justify-end mb-1">
          <button type="button" className="text-[11px] text-steel hover:text-teal cursor-pointer" onClick={() => loadLots(null)}>
            Cerrar este corte (volver al historial)
          </button>
        </div>
      )}
      {lot && <LotView key={`${lot.id}-${lot.status}-${lot.batches.length}`} lot={lot} canSubmit={canSubmit} onOpenBatch={showBatch} onChanged={() => loadLots(lot.id, lot.status)} onDeleted={() => loadLots(null)} />}
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

      <LotHistoryList lots={lots.filter((l) => l.status === "CLOSED")} onView={showLot} defaultOpen={!loading && !lot} />
    </div>
  );
}
