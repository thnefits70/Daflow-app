"use client";

import { useEffect, useState } from "react";
import type { HandoffLock } from "@/lib/handoffLocks";
import { shareHandoffLock, usePublishTabOpen, onHandoffLockRefresh } from "./handoffLockSignal";

// Pedido del usuario 2026-10-15 — ver handoffLocks.ts. Capa encima de la
// pantalla (lo que la persona estaba haciendo queda debajo, no se pierde):
// - asesora B2B: escribir el ID madre de Dropi de cada producto pagado;
// - Bryan: liberar al Kardex con un clic lo que ya llegó.
// Se revisa al abrir, cada minuto y al volver a la pestaña.
// Pedido de Jariel 2026-10-15 (aprobado por el usuario): con el ID madre
// vencido, la asesora B2B ya no escribe el ID en esta capa — solo puede ir a
// Análisis de Mercado > Publicar en Dropi (ve precio, competencia y notas de
// variantes para crearlo bien). Mientras esa pestaña está abierta, la capa
// se quita; en cualquier otra pantalla vuelve a salir.
const PUBLISH_TAB_URL = "/area/workspace?tab=analisis-mercado&ptab=publicar";

function fmt(iso: string) {
  return new Date(iso).toLocaleString("es-EC", { timeZone: "America/Guayaquil", weekday: "short", day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit", hour12: false });
}

export function HandoffLockGate() {
  const [lock, setLock] = useState<HandoffLock | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [err, setErr] = useState<Record<string, string>>({});
  const publishTabOpen = usePublishTabOpen();

  function load() {
    fetch("/api/handoff-lock")
      .then((r) => (r.ok ? r.json() : { lock: null }))
      .then((j) => {
        setLock(j.lock ?? null);
        shareHandoffLock(j.lock ?? null);
      })
      .catch(() => null);
  }
  useEffect(() => {
    load();
    const t = window.setInterval(load, 60_000);
    const onFocus = () => document.visibilityState === "visible" && load();
    document.addEventListener("visibilitychange", onFocus);
    const offRefresh = onHandoffLockRefresh(load);
    return () => {
      window.clearInterval(t);
      document.removeEventListener("visibilitychange", onFocus);
      offRefresh();
    };
  }, []);

  if (!lock || lock.items.length === 0) return null;
  const isId = lock.kind === "id";
  if (isId && publishTabOpen) return null;

  async function act(proposalId: string) {
    setBusy(proposalId);
    setErr((e) => ({ ...e, [proposalId]: "" }));
    const r = await fetch(`/api/market-products/${proposalId}/release-kardex`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({}),
    }).catch(() => null);
    setBusy(null);
    if (!r || !r.ok) {
      const j = r ? await r.json().catch(() => null) : null;
      setErr((e) => ({ ...e, [proposalId]: j?.error ?? "No se pudo guardar. Vuelve a intentarlo." }));
      return;
    }
    load();
  }

  return (
    <div className="fixed inset-0 z-[310] bg-black/75 flex items-center justify-center p-4">
      <div className="bg-surface border border-red/50 rounded-md p-5 max-w-[600px] w-full max-h-[90vh] overflow-y-auto">
        <div className="text-[16px] font-bold text-red">{isId ? "Falta el ID madre de Dropi" : "Falta liberar mercadería al Kardex"}</div>
        <div className="text-[13px] text-steel mt-1.5">
          {isId
            ? "Pasaron 6 horas laborables desde que se pagó la compra y estos productos todavía no tienen ID madre. Mientras falte, la mercadería no entra a INVESTOCK y DAFLOW queda bloqueado: solo puedes usar Publicar en Dropi para crearlos y poner su ID. Apenas los pongas, todo vuelve a la normalidad."
            : "Pasaron 3 horas laborables desde que estos productos tienen ID y su mercadería está en bodega. Mientras no los liberes, aparecen con stock 0 en INVESTOCK."}{" "}
          {!isId && " Lo que estabas haciendo sigue abierto detrás: apenas termines, vuelves a donde estabas."}
        </div>
        {isId && (
          <button
            type="button"
            onClick={() => { window.location.href = PUBLISH_TAB_URL; }}
            className="mt-3 rounded bg-teal px-4 py-2 text-[13px] font-bold text-white cursor-pointer"
          >
            Ir a Publicar en Dropi
          </button>
        )}
        <div className="flex flex-col gap-2 mt-3">
          {lock.items.map((i) => (
            <div key={i.proposalId} className={`border rounded-md p-3 text-[12.5px] ${i.overdue ? "border-red/50 bg-red/5" : "border-rule"}`}>
              <div className="font-semibold text-ink">{i.name}</div>
              <div className="text-steel text-[11.5px]">
                {i.units} un. · {i.overdue ? "venció" : "vence"} {fmt(i.deadline)}
              </div>
              {!isId && (
              <div className="flex items-center gap-2 mt-2">
                <button
                  type="button"
                  disabled={busy === i.proposalId}
                  onClick={() => act(i.proposalId)}
                  className="rounded bg-teal px-3.5 py-1.5 text-[12.5px] font-bold text-white cursor-pointer disabled:opacity-50 shrink-0"
                >
                  {busy === i.proposalId ? "Guardando…" : "Liberar al Kardex"}
                </button>
              </div>
              )}
              {err[i.proposalId] && <div className="text-red text-[12px] mt-1.5">{err[i.proposalId]}</div>}
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
