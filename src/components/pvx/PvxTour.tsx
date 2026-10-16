"use client";

import { useCallback, useEffect, useLayoutEffect, useState } from "react";
import { IconArrow, IconClose, IconSpark } from "@/components/pvx/PvxIcons";

// Tour guiado de provedix.com (pedido del usuario 2026-10-14): ilumina cada
// parte de la página y explica para qué sirve. Se abre con el botón "Guía"
// (para todos), sale solo una vez a quien se acaba de registrar, y cuando hay
// mejoras nuevas muestra solo las novedades.
//
// CÓMO AGREGAR UNA NOVEDAD: sube TOUR_VERSION en 1, agrega el paso con
// `since: <la nueva versión>` y pon `data-tour="<id>"` en el elemento.
// Quien ya vio la guía verá solo los pasos nuevos (y el botón se ilumina).
// 4 (2026-10-16): todo se atiende por Michelle IA, ya no por WhatsApp.
export const TOUR_VERSION = 4;
const SEEN_KEY = "pvx-tour-seen";

type Step = { id: string; since: number; title: string; text: string };

const STEPS: Step[] = [
  {
    id: "search",
    since: 1,
    title: "Busca cualquier producto",
    text: "Escribe un nombre o un ID de Dropi y ves al instante cuánto se vende.",
  },
  {
    id: "demo",
    since: 1,
    title: "Cómo funciona en 20 segundos",
    text: "Este video corto te muestra los 4 pasos: buscar, ver ventas, copiar el ID y vender.",
  },
  {
    id: "filters",
    since: 1,
    title: "Filtra el catálogo",
    text: "Por marca, por productos En subida o por los que acaban de recibir Nuevo stock.",
  },
  {
    id: "card",
    since: 1,
    title: "Cada producto en una tarjeta",
    text: "Cuánto se vende en 30 días, su puesto en el ranking y la gráfica de ventas día a día.",
  },
  {
    id: "card-id",
    since: 1,
    title: "Copia el ID con un toque",
    text: "Lo pegas en Dropi para publicarlo. El botón naranja de abajo lo abre directo en Dropi.",
  },
  {
    id: "card-asesor",
    since: 1,
    title: "Pregúntale a Michelle IA",
    text: "Te abre el chat con el producto ya escrito: te responde al instante.",
  },
  {
    id: "card-cta",
    since: 1,
    title: "La ficha completa",
    text: "Precio al que se vende, cuánto ganas, ciudades, quién compra y combos. Gratis al registrarte.",
  },
  {
    id: "cortes",
    since: 1,
    title: "Cortes en vivo",
    text: "Cuenta regresiva al próximo corte: tu pedido sale en menos de 3 horas.",
  },
  {
    id: "recursos",
    since: 1,
    title: "Todo para vender",
    text: "Creativos gratis para tus anuncios, rastreo de guías y cómo pedir una garantía.",
  },
  {
    id: "canales",
    since: 1,
    title: "Productos nuevos primero",
    text: "Únete a nuestros canales de WhatsApp para enterarte antes que nadie.",
  },
  {
    id: "calc",
    since: 3,
    title: "¿A cuánto lo vendo?",
    text: "Pon el precio en Dropi, tu flete y tu CPA, y te decimos el precio que te deja ganancia y cuánto puedes pagar de publicidad sin perder.",
  },
  {
    id: "chat",
    since: 4,
    title: "Todo por Michelle IA",
    text: "Dudas, garantías, cancelaciones y pedidos: todo aquí. Te responde al instante y, si tu caso necesita a una persona, el equipo te contesta en este mismo chat. Puedes adjuntar fotos o videos con 📎.",
  },
  {
    id: "help",
    since: 1,
    title: "Vuelve a ver esta guía",
    text: "Toca el ? cuando quieras. Cuando agreguemos mejoras, se marca con un punto naranja.",
  },
];

function readSeen(): number {
  try {
    return Number(localStorage.getItem(SEEN_KEY) ?? 0) || 0;
  } catch {
    return 0;
  }
}
function markSeen() {
  try {
    localStorage.setItem(SEEN_KEY, String(TOUR_VERSION));
  } catch {
    // sin almacenamiento (modo privado): la guía igual funciona.
  }
}

type Rect = { top: number; left: number; width: number; height: number };

function Spotlight({ steps, onClose }: { steps: Step[]; onClose: () => void }) {
  const [i, setI] = useState(0);
  const [rect, setRect] = useState<Rect | null>(null);
  const step = steps[i];

  const measure = useCallback(() => {
    const el = document.querySelector(`[data-tour="${step.id}"]`);
    if (!el) return;
    const r = el.getBoundingClientRect();
    setRect({
      top: r.top - 8,
      left: r.left - 8,
      width: r.width + 16,
      height: r.height + 16,
    });
  }, [step.id]);

  // Lleva el elemento a la vista y lo mide.
  useLayoutEffect(() => {
    const el = document.querySelector(`[data-tour="${step.id}"]`);
    if (!el) return;
    const behavior: ScrollBehavior = window.matchMedia(
      "(prefers-reduced-motion: reduce)",
    ).matches
      ? "auto"
      : "smooth";
    const r = el.getBoundingClientRect();
    // Si es muy alto (pasa del 55 % de la pantalla), se muestra desde su
    // inicio y la cajita queda abajo; si no, centrado.
    if (r.height > window.innerHeight * 0.55)
      window.scrollTo({ top: window.scrollY + r.top - 24, behavior });
    else el.scrollIntoView({ block: "center", behavior });
    const t = setTimeout(measure, 450);
    return () => clearTimeout(t);
  }, [step.id, measure]);

  useEffect(() => {
    window.addEventListener("resize", measure);
    window.addEventListener("scroll", measure, { passive: true });
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
      if (e.key === "ArrowRight")
        setI((x) => Math.min(steps.length - 1, x + 1));
      if (e.key === "ArrowLeft") setI((x) => Math.max(0, x - 1));
    };
    window.addEventListener("keydown", onKey);
    return () => {
      window.removeEventListener("resize", measure);
      window.removeEventListener("scroll", measure);
      window.removeEventListener("keydown", onKey);
    };
  }, [measure, onClose, steps.length]);

  const vw = typeof window === "undefined" ? 1024 : window.innerWidth;
  const vh = typeof window === "undefined" ? 768 : window.innerHeight;
  const cardW = Math.min(360, vw - 32);
  // Dónde va la cajita: abajo del elemento, arriba, a un costado o, si el
  // elemento es muy alto, fija abajo de la pantalla (siempre visible).
  const CARD_H = 230;
  const clampX = (x: number) => Math.min(Math.max(16, x), vw - cardW - 16);
  const clampY = (y: number) => Math.min(Math.max(16, y), vh - CARD_H - 16);
  let cardTop = (vh - CARD_H) / 2;
  let cardLeft = (vw - cardW) / 2;
  if (rect) {
    const bottom = rect.top + rect.height;
    if (vh - bottom >= CARD_H + 24) {
      cardTop = bottom + 12;
      cardLeft = clampX(rect.left + rect.width / 2 - cardW / 2);
    } else if (rect.top >= CARD_H + 24) {
      cardTop = rect.top - CARD_H - 12;
      cardLeft = clampX(rect.left + rect.width / 2 - cardW / 2);
    } else if (vw - (rect.left + rect.width) >= cardW + 32) {
      cardTop = clampY(rect.top);
      cardLeft = rect.left + rect.width + 16;
    } else if (rect.left >= cardW + 32) {
      cardTop = clampY(rect.top);
      cardLeft = rect.left - cardW - 16;
    } else {
      cardTop = vh - CARD_H - 16;
      cardLeft = (vw - cardW) / 2;
    }
  }
  const last = i === steps.length - 1;

  return (
    <div
      className="fixed inset-0 z-[70]"
      role="dialog"
      aria-modal="true"
      aria-label="Guía de Provedix"
    >
      {/* Fondo oscuro con el hueco iluminado sobre el elemento. */}
      <div
        className="pvx-tour-hole pointer-events-none absolute rounded-2xl"
        style={
          rect
            ? {
                top: rect.top,
                left: rect.left,
                width: rect.width,
                height: rect.height,
              }
            : { top: vh / 2, left: vw / 2, width: 0, height: 0 }
        }
      />
      <div className="absolute inset-0" onClick={(e) => e.stopPropagation()} />
      <div
        className="pvx-pop absolute rounded-3xl bg-white p-5 text-[var(--pvx-ink)] shadow-[0_24px_60px_-20px_rgb(0_0_0/0.6)]"
        style={{ width: cardW, top: cardTop, left: cardLeft, minHeight: 0 }}
      >
        <div className="flex items-start justify-between gap-3">
          <div>
            <div className="flex items-center gap-2 text-[12px] font-bold text-[var(--pvx-orange-text)]">
              {step.since > 1 && (
                <span className="inline-flex items-center gap-1 rounded-full bg-[var(--pvx-orange)] px-2 py-0.5 text-white">
                  <IconSpark className="w-3 h-3" /> Nuevo
                </span>
              )}
              Paso {i + 1} de {steps.length}
            </div>
            <h3 className="pvx-heading mt-1 text-[20px]">{step.title}</h3>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Cerrar la guía"
            className="pvx-press grid h-8 w-8 shrink-0 place-items-center rounded-full bg-[var(--pvx-paper-2)] hover:bg-[var(--pvx-paper-3)] cursor-pointer"
          >
            <IconClose className="w-4 h-4" />
          </button>
        </div>
        <p className="mt-2 text-[14.5px] leading-relaxed text-[var(--pvx-ink-2)]">
          {step.text}
        </p>
        <div className="mt-4 flex items-center justify-between gap-2">
          <div className="flex gap-1" aria-hidden>
            {steps.map((s, k) => (
              <span
                key={s.id}
                className={`h-1.5 rounded-full transition-all duration-200 ${k === i ? "w-5 bg-[var(--pvx-orange)]" : "w-1.5 bg-[var(--pvx-paper-3)]"}`}
              />
            ))}
          </div>
          <div className="flex gap-2">
            {i > 0 && (
              <button
                type="button"
                onClick={() => setI(i - 1)}
                className="pvx-press rounded-full bg-[var(--pvx-paper-2)] px-4 py-2 text-[13.5px] font-bold hover:bg-[var(--pvx-paper-3)] cursor-pointer"
              >
                Atrás
              </button>
            )}
            <button
              type="button"
              autoFocus
              onClick={() => (last ? onClose() : setI(i + 1))}
              className="pvx-press inline-flex items-center gap-1.5 rounded-full bg-[var(--pvx-orange)] px-4 py-2 text-[13.5px] font-bold text-white hover:bg-[var(--pvx-orange-press)] cursor-pointer"
            >
              {last ? "Listo" : "Siguiente"}{" "}
              {!last && <IconArrow className="w-3.5 h-3.5" />}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

// Botón "Guía" + tour. `autoStart`: lo pide la página (recién registrado, o
// registrado con novedades sin ver) cuando no hay ninguna ventana abierta.
export function PvxTour({ autoStart }: { autoStart: boolean }) {
  const [seen, setSeen] = useState<number | null>(null);
  const [steps, setSteps] = useState<Step[] | null>(null);
  const [menu, setMenu] = useState(false);

  useEffect(() => {
    const t = setTimeout(() => setSeen(readSeen()), 0);
    return () => clearTimeout(t);
  }, []);

  const available = () =>
    STEPS.filter((s) => document.querySelector(`[data-tour="${s.id}"]`));
  const fresh = seen != null && seen > 0 && seen < TOUR_VERSION;
  const start = useCallback((onlyNew: boolean) => {
    const list = STEPS.filter(
      (s) =>
        document.querySelector(`[data-tour="${s.id}"]`) &&
        (!onlyNew || s.since > (readSeen() || 0)),
    );
    if (list.length) setSteps(list);
    setMenu(false);
  }, []);

  // Sale solo: la primera vez (nunca la vio) o cuando hay novedades.
  useEffect(() => {
    if (!autoStart || seen == null || seen >= TOUR_VERSION || steps) return;
    const t = setTimeout(() => start(seen > 0), 900);
    return () => clearTimeout(t);
  }, [autoStart, seen, steps, start]);

  function close() {
    markSeen();
    setSeen(TOUR_VERSION);
    setSteps(null);
  }

  return (
    <>
      <div className="fixed bottom-4 left-4 z-[45] sm:bottom-6 sm:left-6">
        {menu && fresh && (
          <div className="pvx-pop absolute bottom-full left-0 mb-2 w-[230px] overflow-hidden rounded-2xl bg-white p-1.5 text-[var(--pvx-ink)] shadow-[0_20px_50px_-15px_rgb(0_0_0/0.5)]">
            <button
              type="button"
              onClick={() => start(true)}
              className="flex w-full items-center gap-2 rounded-xl px-3 py-2.5 text-left text-[14px] font-bold hover:bg-[var(--pvx-paper-2)] cursor-pointer"
            >
              <IconSpark className="w-4 h-4 text-[var(--pvx-orange)]" /> Ver
              novedades
            </button>
            <button
              type="button"
              onClick={() => start(false)}
              className="flex w-full items-center gap-2 rounded-xl px-3 py-2.5 text-left text-[14px] font-semibold hover:bg-[var(--pvx-paper-2)] cursor-pointer"
            >
              Ver la guía completa
            </button>
          </div>
        )}
        <button
          type="button"
          data-tour="help"
          onClick={() =>
            fresh ? setMenu(!menu) : available().length && start(false)
          }
          aria-label={
            fresh ? "Guía: hay novedades" : "Ver la guía de la página"
          }
          // Solo el "?" (pedido del usuario 2026-10-15: la palabra ocupaba mucho); en computadora se ve al pasar el mouse.
          className="pvx-press group relative inline-flex items-center rounded-full bg-[var(--pvx-ink)] p-2.5 text-[14px] font-bold text-white shadow-[0_12px_30px_-10px_rgb(0_0_0/0.6)] ring-1 ring-white/15 hover:bg-[#25282f] cursor-pointer"
        >
          <span className="grid h-6 w-6 place-items-center rounded-full bg-[var(--pvx-orange)] text-[13px] font-black">
            ?
          </span>
          <span className="max-w-0 overflow-hidden whitespace-nowrap transition-[max-width,margin] duration-200 group-hover:ml-2 group-hover:mr-1.5 group-hover:max-w-[120px] group-focus-visible:ml-2 group-focus-visible:mr-1.5 group-focus-visible:max-w-[120px]">
            {fresh ? "Novedades" : "Guía"}
          </span>
          {fresh && (
            <span className="absolute -right-0.5 -top-0.5 h-3 w-3 rounded-full bg-[var(--pvx-orange)] ring-2 ring-[var(--pvx-ink)]" />
          )}
        </button>
      </div>
      {steps && <Spotlight steps={steps} onClose={close} />}
    </>
  );
}
