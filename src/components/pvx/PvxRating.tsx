"use client";

import { useEffect, useRef, useState } from "react";
import { IconClose } from "@/components/pvx/PvxIcons";

// Calificación de las herramientas de provedix.com (pedido del usuario
// 2026-10-15): después de usar algo de verdad, una tarjetita pequeña pide 1 a
// 5 estrellas + comentario opcional. Solo a registrados, una pregunta por
// visita, y la misma herramienta no se vuelve a preguntar en 30 días (7 si
// pulsa "Ahora no"). Lo que escriben solo lo ve el admin.

export type PvxRatingTool = "catalogo" | "datos" | "calculadora" | "michelle";

const PVX_USE_EVENT = "pvx-use";

// Las herramientas avisan cada vez que se usan.
export function markPvxUse(tool: PvxRatingTool) {
  window.dispatchEvent(new CustomEvent(PVX_USE_EVENT, { detail: tool }));
}

const TOOLS: Record<PvxRatingTool, { question: string; uses: number; wait: number }> = {
  // 2 búsquedas: ya buscó de verdad.
  catalogo: { question: "¿Qué tan fácil fue encontrar productos?", uses: 2, wait: 20_000 },
  // 2 fichas abiertas: ya vio los datos de venta.
  datos: { question: "¿Qué tan útiles te parecen los datos de venta?", uses: 2, wait: 3_000 },
  calculadora: { question: "¿Qué tan útil te pareció la calculadora?", uses: 1, wait: 25_000 },
  // 2 respuestas de Michelle IA.
  michelle: { question: "¿Cómo te ayudó Michelle IA?", uses: 2, wait: 3_000 },
};

const LABELS = ["Muy mala", "Mala", "Regular", "Buena", "Excelente"];
const DAY = 86_400_000;
const snoozeKey = (t: PvxRatingTool) => `pvx-rate-${t}`;

function snoozed(t: PvxRatingTool): boolean {
  try {
    return Number(localStorage.getItem(snoozeKey(t)) ?? 0) > Date.now();
  } catch {
    return false;
  }
}
function snooze(t: PvxRatingTool, days: number) {
  try {
    localStorage.setItem(snoozeKey(t), String(Date.now() + days * DAY));
  } catch {
    /* sin almacenamiento: puede volver a preguntar en otra visita */
  }
}

// Solo se pregunta si no hay otra ventana encima (ficha, registro, chat o guía).
function pageIsFree(): boolean {
  if (document.body.style.overflow === "hidden") return false;
  if (document.body.dataset.pvxChat === "1") return false;
  if (document.querySelector('[aria-label="Guía de Provedix"]')) return false;
  return true;
}

function Star({ on }: { on: boolean }) {
  return (
    <svg viewBox="0 0 24 24" className="h-8 w-8" aria-hidden>
      <path
        d="M12 3.2l2.7 5.6 6.1.8-4.5 4.2 1.1 6.1L12 17l-5.4 2.9 1.1-6.1-4.5-4.2 6.1-.8L12 3.2Z"
        fill={on ? "var(--pvx-orange)" : "none"}
        stroke={on ? "var(--pvx-orange)" : "var(--pvx-paper-3)"}
        strokeWidth={1.8}
        strokeLinejoin="round"
      />
    </svg>
  );
}

export function PvxRating({ registered }: { registered: boolean }) {
  const uses = useRef<Partial<Record<PvxRatingTool, number>>>({});
  const askedThisVisit = useRef(false);
  const [pending, setPending] = useState<{ tool: PvxRatingTool; at: number } | null>(null);
  const [tool, setTool] = useState<PvxRatingTool | null>(null);
  const [stars, setStars] = useState(0);
  const [hover, setHover] = useState(0);
  const [comment, setComment] = useState("");
  const [allowPublic, setAllowPublic] = useState(false);
  const [sending, setSending] = useState(false);
  const [thanks, setThanks] = useState(false);

  // Cuenta los usos; al llegar al mínimo queda lista para preguntar.
  useEffect(() => {
    const onUse = (e: Event) => {
      const t = (e as CustomEvent<PvxRatingTool>).detail;
      if (!(t in TOOLS)) return;
      const n = (uses.current[t] ?? 0) + 1;
      uses.current[t] = n;
      if (n === TOOLS[t].uses && !askedThisVisit.current && !snoozed(t))
        setPending((p) => p ?? { tool: t, at: Date.now() });
    };
    window.addEventListener(PVX_USE_EVENT, onUse);
    return () => window.removeEventListener(PVX_USE_EVENT, onUse);
  }, []);

  // Espera a que termine lo que estaba haciendo y a que no haya otra ventana.
  useEffect(() => {
    if (!pending || !registered || askedThisVisit.current) return;
    let alive = true;
    const iv = setInterval(async () => {
      if (Date.now() - pending.at < TOOLS[pending.tool].wait || !pageIsFree()) return;
      clearInterval(iv);
      askedThisVisit.current = true;
      const d = await fetch(`/api/pvx/rating?tool=${pending.tool}`)
        .then((r) => (r.ok ? r.json() : null))
        .catch(() => null);
      if (!alive) return;
      if (d?.ask) setTool(pending.tool);
      else snooze(pending.tool, 30);
      setPending(null);
    }, 1500);
    return () => {
      alive = false;
      clearInterval(iv);
    };
  }, [pending, registered]);

  function close(days: number) {
    if (tool) snooze(tool, days);
    setTool(null);
  }

  async function send() {
    if (!tool || !stars || sending) return;
    setSending(true);
    const res = await fetch("/api/pvx/rating", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ tool, stars, comment: comment.trim() || undefined, allowPublic }),
    }).catch(() => null);
    setSending(false);
    if (!res?.ok) return;
    snooze(tool, 30);
    setThanks(true);
    setTimeout(() => {
      setTool(null);
      setThanks(false);
    }, 2500);
  }

  if (!tool) return null;
  const shown = hover || stars;

  return (
    <div
      role="dialog"
      aria-label="Califica esta herramienta"
      className="pvx-pop fixed inset-x-3 bottom-20 z-[48] rounded-3xl bg-white p-4 text-[var(--pvx-ink)] shadow-[0_24px_60px_-18px_rgb(0_0_0/0.5)] ring-1 ring-black/5 sm:inset-x-auto sm:bottom-24 sm:left-6 sm:w-[360px]"
    >
      {thanks ? (
        <div className="py-4 text-center">
          <div className="text-[17px] font-bold">¡Gracias por tu opinión! 🙌</div>
          <div className="mt-1 text-[13px] text-[var(--pvx-ink-2)]">Nos ayuda a mejorar Provedix para ti.</div>
        </div>
      ) : (
        <>
          <div className="flex items-start justify-between gap-3">
            <div>
              <div className="text-[15px] font-bold leading-snug">{TOOLS[tool].question}</div>
              <div className="mt-0.5 text-[12px] text-[var(--pvx-ink-3)]">Tu opinión nos ayuda a mejorar.</div>
            </div>
            <button
              type="button"
              onClick={() => close(7)}
              aria-label="Cerrar"
              className="-mr-1 -mt-1 rounded-full p-1.5 text-[var(--pvx-ink-3)] hover:bg-[var(--pvx-paper-2)] cursor-pointer"
            >
              <IconClose className="h-4 w-4" />
            </button>
          </div>
          <div className="mt-3 flex items-center gap-1" onMouseLeave={() => setHover(0)}>
            {[1, 2, 3, 4, 5].map((n) => (
              <button
                key={n}
                type="button"
                aria-label={`${n} de 5 estrellas: ${LABELS[n - 1]}`}
                aria-pressed={stars === n}
                onClick={() => setStars(n)}
                onMouseEnter={() => setHover(n)}
                className="pvx-press rounded-lg p-0.5 cursor-pointer"
              >
                <Star on={n <= shown} />
              </button>
            ))}
            <span className="ml-2 text-[13px] font-semibold text-[var(--pvx-ink-2)]">{shown ? LABELS[shown - 1] : ""}</span>
          </div>
          {stars > 0 && (
            <>
              <textarea
                value={comment}
                onChange={(e) => setComment(e.target.value.slice(0, 600))}
                rows={3}
                placeholder={stars <= 3 ? "¿Qué podemos mejorar? (opcional)" : "¿Qué te gustó? (opcional)"}
                className="mt-3 w-full resize-none rounded-2xl border border-[var(--pvx-paper-3)] bg-[var(--pvx-paper-2)] px-3.5 py-2.5 text-[14px] outline-none focus:border-[var(--pvx-orange)]"
              />
              {comment.trim() && (
                <label className="mt-2 flex items-start gap-2 text-[12.5px] text-[var(--pvx-ink-2)] cursor-pointer">
                  <input
                    type="checkbox"
                    checked={allowPublic}
                    onChange={(e) => setAllowPublic(e.target.checked)}
                    className="mt-0.5 h-4 w-4 accent-[var(--pvx-orange)]"
                  />
                  Permito que mi comentario se muestre en la página (solo con mi primer nombre)
                </label>
              )}
              <div className="mt-3 flex items-center justify-between gap-3">
                <button
                  type="button"
                  onClick={() => close(7)}
                  className="text-[13px] font-semibold text-[var(--pvx-ink-3)] cursor-pointer"
                >
                  Ahora no
                </button>
                <button
                  type="button"
                  onClick={send}
                  disabled={sending}
                  className="pvx-press rounded-full bg-[var(--pvx-orange)] px-5 py-2.5 text-[14px] font-bold text-white hover:bg-[var(--pvx-orange-press)] disabled:opacity-60 cursor-pointer"
                >
                  {sending ? "Enviando…" : "Enviar"}
                </button>
              </div>
            </>
          )}
        </>
      )}
    </div>
  );
}
