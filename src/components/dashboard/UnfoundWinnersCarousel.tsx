"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { ChevronLeft, ChevronRight } from "lucide-react";

type Item = { id: string; productName: string; imageUrl: string; competitorPrice: number | null; status: "PENDING" | "PROPOSED" | "DISCARDED"; createdAt: string };

const CARD_W = 170;
const GAP = 12;
const STEP = CARD_W + GAP;
const INTERVAL_MS = 3000;
const SLIDE_MS = 700;
const LIST_URL = "/area/workspace?tab=analisis-mercado&ptab=ganadores";

// Confirmado 2026-09-23, pedido de Jariel: los "Ganadores no encontrados"
// que siguen buscando proveedor pasan en carrusel en Inicio (entre el podio
// y las tarjetas), para tenerlos siempre a la vista sin entrar a la
// sección. Pasan TODOS los pendientes en fila (corregido el mismo día,
// pedido del usuario: nada de "12 distintos por día"), y en pantalla se ven
// los que entren a lo ancho. Se mueve solo de derecha a izquierda cada 3 s
// y cada tarjeta abre la lista completa. Corregido 2026-09-23 (Jariel: "no
// se mueve"): ya NO se pausa al pasar el mouse — con el puntero encima (o
// tras tocarlo en el celular, donde nunca llega el "mouse leave") quedaba
// quieto. Quien no es de Análisis
// de Mercado recibe 403 y no ve nada.
export function UnfoundWinnersCarousel() {
  const [items, setItems] = useState<Item[] | null>(null);
  const [index, setIndex] = useState(0);
  const [animate, setAnimate] = useState(true);
  const [width, setWidth] = useState(0);
  const viewportRef = useRef<HTMLDivElement>(null);

  function load() {
    fetch("/api/unfound-winning-products")
      .then((r) => (r.ok ? r.json() : []))
      .then((rows: Item[]) => {
        // Los más nuevos primero.
        setItems(rows.filter((r) => r.status === "PENDING").sort((a, b) => b.createdAt.localeCompare(a.createdAt)));
      })
      .catch(() => setItems([]));
  }
  useEffect(load, []);

  useEffect(() => {
    const el = viewportRef.current;
    if (!el) return;
    const ro = new ResizeObserver(() => setWidth(el.clientWidth));
    ro.observe(el);
    return () => ro.disconnect();
  }, [items]);

  const n = items?.length ?? 0;
  // Solo se mueve si no entran todas a la vez en la pantalla.
  const moves = n > 0 && n * STEP - GAP > width;

  useEffect(() => {
    if (!moves) return;
    const t = setInterval(() => {
      // Con la pestaña oculta el navegador no termina la animación — se
      // espera a que vuelva para no descuadrar el giro.
      if (document.hidden) return;
      setAnimate(true);
      setIndex((i) => i + 1);
    }, INTERVAL_MS);
    return () => clearInterval(t);
  }, [moves]);

  // Al llegar a la copia del primero, salta sin animación al original —
  // así el giro es infinito y nunca se ve un "rebobinado". Se hace con un
  // temporizador del largo de la animación, no con transitionend (que a
  // veces no llega y dejaba el carrusel trabado al final de la fila).
  useEffect(() => {
    if (!moves || index < n) return;
    const t = setTimeout(() => { setAnimate(false); setIndex((i) => (i >= n ? i - n : i)); }, SLIDE_MS + 50);
    return () => clearTimeout(t);
  }, [index, n, moves]);

  function go(delta: 1 | -1) {
    if (!moves) return;
    if (delta === 1) {
      setAnimate(true);
      setIndex((i) => (i >= n ? 1 : i + 1));
      return;
    }
    if (index > 0 && index <= n) { setAnimate(true); setIndex(index - 1); return; }
    // Desde el primero: salta sin animación a su copia y recién ahí retrocede.
    setAnimate(false);
    setIndex(n);
    requestAnimationFrame(() => requestAnimationFrame(() => { setAnimate(true); setIndex(n - 1); }));
  }

  if (!items || n === 0) return null;

  const track = moves ? [...items, ...items] : items;
  const offset = moves ? index : 0;

  return (
    <div className="bg-surface border border-rule rounded-lg p-4 mb-6">
      <div className="flex items-center justify-between gap-3 mb-3">
        <div>
          <div className="flex items-center gap-2 text-[13px] font-bold">
            <span className="w-1.5 h-1.5 rounded-full shrink-0 bg-teal" style={{ boxShadow: "0 0 0 3px rgba(20,199,199,.18)" }} />
            Ganadores no encontrados
          </div>
          <div className="text-[11px] text-steel">
            Buscando proveedor — {n} producto{n === 1 ? "" : "s"}
          </div>
        </div>
        <div className="flex items-center gap-2 shrink-0">
          {moves && (
            <>
              <button type="button" aria-label="Anterior" className="w-7 h-7 rounded-full border border-rule flex items-center justify-center text-steel hover:text-ink hover:border-teal cursor-pointer" onClick={() => go(-1)}>
                <ChevronLeft size={15} />
              </button>
              <button type="button" aria-label="Siguiente" className="w-7 h-7 rounded-full border border-rule flex items-center justify-center text-steel hover:text-ink hover:border-teal cursor-pointer" onClick={() => go(1)}>
                <ChevronRight size={15} />
              </button>
            </>
          )}
          <Link href={LIST_URL} className="text-[11px] font-bold text-blue">Ver todos →</Link>
        </div>
      </div>

      <div ref={viewportRef} className="overflow-hidden">
        <div
          className="flex"
          style={{
            gap: GAP,
            transform: `translateX(-${offset * STEP}px)`,
            transition: animate ? `transform ${SLIDE_MS}ms ease-in-out` : "none",
          }}
        >
          {track.map((p, i) => (
            <a
              key={`${p.id}-${i}`}
              href={LIST_URL}
              className="shrink-0 rounded-md border border-rule bg-cloud overflow-hidden hover:border-teal"
              style={{ width: CARD_W }}
            >
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={p.imageUrl} alt={p.productName} className="w-full object-cover bg-white" style={{ height: CARD_W }} />
              <div className="px-2.5 py-2">
                <div className="text-[16px] font-bold text-teal leading-tight">
                  {p.competitorPrice !== null ? `$${p.competitorPrice.toFixed(2)}` : "Sin precio"}
                </div>
                <div className="text-[13px] text-ink leading-snug mt-0.5 line-clamp-2 min-h-[2.5em] first-letter:uppercase">{p.productName}</div>
              </div>
            </a>
          ))}
        </div>
      </div>
    </div>
  );
}
