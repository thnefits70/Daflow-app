"use client";

import { useEffect, useState } from "react";
import type { PendingExtension } from "@/lib/handoffLocks";

// Pedido del usuario 2026-10-15 — ver handoffLocks.ts. Arriba de Análisis de
// Mercado, solo para Bryan y el admin:
// - «Dropi está caído» / «Dropi ya volvió»: mientras está caído, los relojes
//   del ID madre y de liberar al Kardex no corren;
// - (solo admin) los pedidos de más tiempo de la asesora B2B, con su captura.
type State = { canToggle: boolean; isAdmin?: boolean; outage: { startedAt: string; startedByName: string; note: string | null } | null; extensions: PendingExtension[] };

function fmt(iso: string) {
  return new Date(iso).toLocaleString("es-EC", { timeZone: "America/Guayaquil", weekday: "short", day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit", hour12: false });
}

export function DropiOutageBar() {
  const [s, setS] = useState<State | null>(null);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState("");
  const [err, setErr] = useState("");

  function load() {
    fetch("/api/dropi-outage")
      .then((r) => (r.ok ? r.json() : null))
      .then(setS)
      .catch(() => null);
  }
  useEffect(load, []);

  if (!s?.canToggle) return null;

  async function post(url: string, body: object, confirmText?: string) {
    if (confirmText && !window.confirm(confirmText)) return;
    setBusy(true);
    setErr("");
    setMsg("");
    const r = await fetch(url, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) }).catch(() => null);
    const j = r ? await r.json().catch(() => null) : null;
    setBusy(false);
    if (!r || !r.ok) return setErr(j?.error ?? "No se pudo guardar. Vuelve a intentarlo.");
    setMsg(j?.message ?? "Listo.");
    load();
  }

  return (
    <div className="mb-4 flex flex-col gap-2">
      <div className={`rounded-md border px-3.5 py-2.5 text-[12.5px] flex flex-wrap items-center gap-3 ${s.outage ? "border-red/50 bg-red/5" : "border-rule"}`}>
        {s.outage ? (
          <>
            <span className="text-ink">
              <b className="text-red">🔴 Dropi marcado como caído</b> desde {fmt(s.outage.startedAt)} por {s.outage.startedByName}
              {s.outage.note ? ` — ${s.outage.note}` : ""}. Los plazos del ID madre y de liberar al Kardex están en pausa.
            </span>
            <button type="button" disabled={busy} onClick={() => post("/api/dropi-outage", { down: false }, "¿Dropi ya funciona? Los relojes vuelven a correr desde donde quedaron.")} className="rounded bg-teal px-3 py-1.5 text-[12px] font-bold text-white cursor-pointer disabled:opacity-50">
              Dropi ya volvió
            </button>
          </>
        ) : (
          <>
            <span className="text-steel">¿Dropi no funciona para nadie? Márcalo y se pausan los plazos del ID madre y de liberar al Kardex.</span>
            <button type="button" disabled={busy} onClick={() => post("/api/dropi-outage", { down: true }, "¿Dropi está caído? Se pausan los plazos de la asesora B2B y de Bryan hasta que marques «Dropi ya volvió».")} className="rounded border border-red/60 px-3 py-1.5 text-[12px] font-bold text-red cursor-pointer disabled:opacity-50">
              Dropi está caído
            </button>
          </>
        )}
      </div>
      {s.isAdmin &&
        s.extensions.map((e) => (
          <div key={e.id} className="rounded-md border border-gold/60 bg-gold/5 px-3.5 py-2.5 text-[12.5px] flex flex-wrap items-center gap-3">
            <span className="text-ink flex-1 min-w-[240px]">
              <b>⏳ {e.requestedByName ?? "La asesora B2B"} pide más tiempo</b> para el ID madre de <b>{e.name}</b>: «{e.reason}» · {fmt(e.requestedAt)}
              {e.photoUrl && (
                <>
                  {" · "}
                  <a href={e.photoUrl} target="_blank" rel="noreferrer" className="text-teal underline">ver captura</a>
                </>
              )}
            </span>
            <button type="button" disabled={busy} onClick={() => post(`/api/handoff-lock/extension/${e.id}`, { grant: true })} className="rounded bg-teal px-3 py-1.5 text-[12px] font-bold text-white cursor-pointer disabled:opacity-50">
              Darle 2 horas más
            </button>
            <button type="button" disabled={busy} onClick={() => post(`/api/handoff-lock/extension/${e.id}`, { grant: false })} className="text-[12px] text-steel cursor-pointer">
              No dar más tiempo
            </button>
          </div>
        ))}
      {msg && <div className="text-teal text-[12px]">{msg}</div>}
      {err && <div className="text-red text-[12px]">{err}</div>}
    </div>
  );
}
