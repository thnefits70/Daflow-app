"use client";

import { useEffect, useState } from "react";

// Pedido del usuario 2026-10-01: Daniel tenía 13 cortes en Inicio y los
// confirmaba uno por uno, así que el stock de INVESTOCK quedaba días atrás.
// Acá: el botón para confirmar de una vez todo lo que cuadra en los cortes ya
// contados, y la pantalla que no se salta pasadas 24 horas. La decisión
// sigue siendo de Daniel: nada se confirma solo.

type CountedLot = { id: string; day: string; corte: number; matching: number; off: number; readySince: string; overdue: boolean };
type Gate = { show: boolean; graceHours?: number; lots?: CountedLot[] };

const LOTS_URL = "/area/workspace?tab=egresos&otab=solicitud";

function fmtDay(day: string) {
  const [, m, d] = day.split("-");
  return `${d}/${m}`;
}

function useCountedLots() {
  const [gate, setGate] = useState<Gate | null>(null);
  function load() {
    fetch("/api/fulfillment-lots/counted-gate")
      .then((r) => (r.ok ? r.json() : { show: false }))
      .then(setGate)
      .catch(() => setGate({ show: false }));
  }
  useEffect(load, []);
  return { gate, reload: load };
}

function useConfirmAll(onDone: () => void) {
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState("");
  async function run(matching: number) {
    if (!window.confirm(`¿Estás seguro? Se confirman ${matching} producto(s) que cuadran (lo sacado = lo pedido) y se descuentan del stock de INVESTOCK. Lo que no cuadra queda para revisarlo uno por uno.`)) return;
    setBusy(true);
    setMsg("");
    const r = await fetch("/api/fulfillment-lots/confirm-all-matching", { method: "POST" }).catch(() => null);
    const j = r ? await r.json().catch(() => null) : null;
    setBusy(false);
    if (!r || !r.ok || !j) {
      setMsg("No se pudo confirmar. Vuelve a intentarlo.");
      return;
    }
    setMsg(`Listo: ${j.confirmed} producto(s) confirmados en ${j.lots} corte(s).${j.errors?.length ? ` Con problema: ${j.errors.join(" · ")}` : ""}`);
    onDone();
  }
  return { busy, msg, run };
}

// Barra arriba de la pantalla de cortes.
export function CountedLotsBar({ onConfirmed }: { onConfirmed: () => void }) {
  const { gate, reload } = useCountedLots();
  const { busy, msg, run } = useConfirmAll(() => {
    reload();
    onConfirmed();
  });
  const lots = gate?.lots ?? [];
  if (lots.length === 0 && !msg) return null;
  const matching = lots.reduce((s, l) => s + l.matching, 0);
  const off = lots.reduce((s, l) => s + l.off, 0);
  return (
    <div className="bg-red/10 border-[1.5px] border-red/45 rounded-md p-3.5 mb-4">
      {lots.length > 0 && (
        <>
          <div className="text-[13px] font-bold text-red">
            {lots.length} corte{lots.length === 1 ? "" : "s"} contado{lots.length === 1 ? "" : "s"} sin confirmar — el stock está desactualizado desde el {fmtDay(lots[0].day)}
          </div>
          <div className="text-[12px] text-steel mt-1">
            Tu equipo ya contó todo. {matching} producto{matching === 1 ? "" : "s"} cuadran
            {off > 0 ? ` y ${off} no cuadran (esos se revisan uno por uno dentro de cada corte)` : ""}. Mientras no confirmes, no baja del stock.
          </div>
          {matching > 0 && (
            <button
              type="button"
              disabled={busy}
              onClick={() => run(matching)}
              className="mt-2.5 rounded bg-teal px-3.5 py-2 text-[12.5px] font-bold text-white cursor-pointer disabled:opacity-60"
            >
              {busy ? "Confirmando…" : `Confirmar todos los que cuadran (${matching})`}
            </button>
          )}
        </>
      )}
      {msg && <div className="text-[12px] text-ink mt-2">{msg}</div>}
    </div>
  );
}

// Pantalla que no se salta (en todo /area, menos en la propia pantalla de
// cortes, donde Daniel revisa lo que no cuadra).
export function CountedLotsGate() {
  const { gate, reload } = useCountedLots();
  const { busy, msg, run } = useConfirmAll(reload);
  const [writing, setWriting] = useState(false);
  const [reason, setReason] = useState("");
  const [sending, setSending] = useState(false);
  const [err, setErr] = useState("");
  const [onLotsScreen] = useState(() => {
    if (typeof window === "undefined") return false;
    const q = new URLSearchParams(window.location.search);
    return window.location.pathname.startsWith("/area/workspace") && q.get("tab") === "egresos";
  });

  if (!gate?.show || onLotsScreen) return null;
  const lots = gate.lots ?? [];
  const overdue = lots.filter((l) => l.overdue);
  const matching = lots.reduce((s, l) => s + l.matching, 0);
  const off = lots.reduce((s, l) => s + l.off, 0);

  async function sendReason() {
    setSending(true);
    setErr("");
    const r = await fetch("/api/fulfillment-lots/counted-gate", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ reason }),
    }).catch(() => null);
    setSending(false);
    if (!r || !r.ok) {
      const j = r ? await r.json().catch(() => null) : null;
      setErr(j?.error ?? "No se pudo enviar. Vuelve a intentarlo.");
      return;
    }
    reload();
  }

  return (
    <div className="fixed inset-0 z-[300] bg-black/70 flex items-center justify-center p-4">
      <div className="bg-surface border border-red/50 rounded-md p-5 max-w-[560px] w-full max-h-[90vh] overflow-y-auto">
        <div className="text-[16px] font-bold text-red">Tienes cortes contados sin confirmar</div>
        <div className="text-[13px] text-steel mt-1.5">
          {overdue.length} corte{overdue.length === 1 ? "" : "s"} lleva{overdue.length === 1 ? "" : "n"} más de {gate.graceHours ?? 24} horas contado
          {overdue.length === 1 ? "" : "s"} por tu equipo. Mientras no los confirmes, el stock de INVESTOCK sigue mostrando mercadería que ya salió, y Compras
          puede comprar mal.
        </div>
        <div className="bg-surface2 border border-rule rounded-md mt-3">
          {lots.map((l) => (
            <div key={l.id} className="flex items-center justify-between gap-2 px-3 py-2 border-b border-rule last:border-b-0 text-[12.5px]">
              <span className="text-ink font-semibold">
                Corte {l.corte} del {fmtDay(l.day)}
                {l.overdue && <span className="text-red font-normal"> · atrasado</span>}
              </span>
              <span className="text-steel">
                {l.matching} cuadran{l.off > 0 ? ` · ${l.off} no cuadran` : ""}
              </span>
            </div>
          ))}
        </div>

        {!writing ? (
          <div className="flex flex-col gap-2 mt-4">
            {matching > 0 && (
              <button
                type="button"
                disabled={busy}
                onClick={() => run(matching)}
                className="rounded bg-teal px-3.5 py-2.5 text-[13px] font-bold text-white cursor-pointer disabled:opacity-60"
              >
                {busy ? "Confirmando…" : `Confirmar todos los que cuadran (${matching})`}
              </button>
            )}
            {off > 0 && (
              <a href={LOTS_URL} className="text-center rounded border border-rule px-3.5 py-2.5 text-[13px] font-semibold text-ink hover:border-teal">
                Revisar los que no cuadran ({off})
              </a>
            )}
            <button type="button" onClick={() => setWriting(true)} className="text-[12.5px] text-steel hover:text-ink cursor-pointer mt-1">
              Todavía no puedo confirmar — escribir por qué
            </button>
          </div>
        ) : (
          <div className="mt-4">
            <div className="text-[12.5px] text-steel mb-1.5">¿Por qué todavía no? Este motivo le llega al administrador.</div>
            <textarea
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              rows={3}
              className="w-full rounded border border-rule bg-surface2 px-2.5 py-2 text-[13px] text-ink"
              placeholder="Ej.: falta revisar el producto X en bodega"
            />
            {err && <div className="text-[12px] text-red mt-1">{err}</div>}
            <div className="flex gap-2 mt-2">
              <button
                type="button"
                disabled={sending || reason.trim().length < 5}
                onClick={sendReason}
                className="rounded bg-teal px-3.5 py-2 text-[12.5px] font-bold text-white cursor-pointer disabled:opacity-60"
              >
                {sending ? "Enviando…" : "Enviar motivo"}
              </button>
              <button type="button" onClick={() => setWriting(false)} className="rounded border border-rule px-3.5 py-2 text-[12.5px] text-steel cursor-pointer">
                Volver
              </button>
            </div>
          </div>
        )}
        {msg && <div className="text-[12px] text-ink mt-3">{msg}</div>}
      </div>
    </div>
  );
}
