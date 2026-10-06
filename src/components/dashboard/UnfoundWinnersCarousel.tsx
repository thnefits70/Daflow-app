"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { computeMaxPurchasePrices } from "@/lib/dropiPricing";

type Item = { id: string; productName: string; imageUrl: string; competitorPrice: number | null };

const CARD_W = 170;
const GAP = 12;
const STEP = CARD_W + GAP;
const INTERVAL_MS = 3000;
const SLIDE_MS = 700;
// Cuánto hay que arrastrar con el dedo para que cuente como "pasar".
const SWIPE_MIN_PX = 40;

// Recuerda en este celular/navegador qué tarjetas ya pasaron por la pantalla
// y por cuál iba — para que al volver a entrar arranque en lo no visto.
const SEEN_KEY = "daflow.unfoundCarousel.seen";
const NEXT_KEY = "daflow.unfoundCarousel.next";

function readSeen(): Set<string> {
  try {
    const raw = localStorage.getItem(SEEN_KEY);
    return new Set(raw ? (JSON.parse(raw) as string[]) : []);
  } catch {
    return new Set();
  }
}
function writeSeen(seen: Set<string>, nextId: string | null) {
  try {
    localStorage.setItem(SEEN_KEY, JSON.stringify([...seen]));
    if (nextId) localStorage.setItem(NEXT_KEY, nextId);
  } catch {}
}
function readNext(): string | null {
  try { return localStorage.getItem(NEXT_KEY); } catch { return null; }
}

// Arranca en el primero que todavía no pasó por la pantalla. Si ya se
// vieron todos, empieza la vuelta de nuevo desde donde se quedó.
function startIndex(items: Item[]): number {
  const seen = readSeen();
  const firstUnseen = items.findIndex((p) => !seen.has(p.id));
  if (firstUnseen >= 0) return firstUnseen;
  const next = readNext();
  writeSeen(new Set(), null);
  const at = next ? items.findIndex((p) => p.id === next) : -1;
  return at >= 0 ? at : 0;
}

// Precio máximo de compra en los 2 casos (sin flete / con flete) — el
// desglose está en la lista completa.
function maxBuyLabel(competitorPrice: number | null) {
  if (competitorPrice === null || competitorPrice <= 0) return "Falta precio competencia";
  const [none, withFreight] = computeMaxPurchasePrices(competitorPrice).scenarios;
  if (none.maxCost === null) return "No alcanza el margen";
  const fmt = (n: number | null) => (n !== null ? `$${n.toFixed(2)}` : "—");
  return (
    <>
      <div>Sin flete: máx. <b className="text-ink">{fmt(none.maxCost)}</b></div>
      <div>Con flete: máx. <b className="text-ink">{fmt(withFreight.maxCost)}</b></div>
    </>
  );
}

// Confirmado 2026-09-23, pedido de Jariel: los "Ganadores no encontrados"
// que siguen buscando proveedor pasan en carrusel en Inicio (entre el podio
// y las tarjetas), para tenerlos siempre a la vista sin entrar a la
// sección. Pasan TODOS los pendientes en fila (corregido el mismo día,
// pedido del usuario: nada de "12 distintos por día"), y en pantalla se ven
// los que entren a lo ancho. Se mueve solo de derecha a izquierda cada 3 s
// y cada tarjeta abre la lista completa. Corregido 2026-09-23 (Jariel: "no
// se mueve"): ya NO se pausa al pasar el mouse — con el puntero encima (o
// tras tocarlo en el celular, donde nunca llega el "mouse leave") quedaba
// quieto. Ampliado 2026-09-23 (pedido del usuario): también lo ven los
// asesores de Ventas Externas (Marcos, Yair) y admin en su propio Inicio —
// ver /api/unfound-winning-products/carousel. Quien no puede abrir la lista
// completa ve las tarjetas sin enlace; el resto recibe 403 y no ve nada.
// Ampliado 2026-09-30 (pedido del usuario): al recargar ya no vuelve
// siempre a los primeros — arranca en los que todavía no pasaron por la
// pantalla (guardado en el navegador); y se puede pasar con el dedo.
export function UnfoundWinnersCarousel() {
  const [items, setItems] = useState<Item[] | null>(null);
  const [listUrl, setListUrl] = useState<string | null>(null);
  // Posición dentro de la fila original (0..n-1). Durante una animación
  // puede salirse un poco del rango; luego se acomoda sin animación.
  const [index, setIndex] = useState(0);
  const [animate, setAnimate] = useState(true);
  const [width, setWidth] = useState(0);
  const [dragDx, setDragDx] = useState(0);
  // Cambia con cada toque para reiniciar la cuenta de 3 s del giro solo.
  const [touchTick, setTouchTick] = useState(0);
  const viewportRef = useRef<HTMLDivElement>(null);
  const drag = useRef<{ x: number; y: number; active: boolean; moved: boolean } | null>(null);
  const justDragged = useRef(false);

  function load() {
    // Ya vienen solo los pendientes, los más nuevos primero.
    fetch("/api/unfound-winning-products/carousel")
      .then((r) => (r.ok ? r.json() : { items: [], listUrl: null }))
      .then((d: { items: Item[]; listUrl: string | null }) => {
        setAnimate(false);
        setIndex(d.items.length > 0 ? startIndex(d.items) : 0);
        setItems(d.items);
        setListUrl(d.listUrl);
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
  // Tarjetas que se ven completas a la vez.
  const visible = Math.max(1, Math.floor((width + GAP) / STEP));

  useEffect(() => {
    if (!moves) return;
    const t = setInterval(() => {
      // Con la pestaña oculta el navegador no termina la animación — se
      // espera a que vuelva para no descuadrar el giro. Tampoco se mueve
      // mientras el dedo está arrastrando.
      if (document.hidden || drag.current?.active) return;
      setAnimate(true);
      setIndex((i) => i + 1);
    }, INTERVAL_MS);
    return () => clearInterval(t);
  }, [moves, touchTick]);

  // Al pasar del final (o del principio) salta sin animación a la misma
  // tarjeta dentro de la fila original — así el giro es infinito y nunca se
  // ve un "rebobinado". Se hace con un temporizador del largo de la
  // animación, no con transitionend (que a veces no llega y dejaba el
  // carrusel trabado al final de la fila).
  useEffect(() => {
    if (!moves || (index >= 0 && index < n)) return;
    const t = setTimeout(() => { setAnimate(false); setIndex((i) => ((i % n) + n) % n); }, SLIDE_MS + 50);
    return () => clearTimeout(t);
  }, [index, n, moves]);

  // Marca como vistas las tarjetas que están en pantalla, y guarda cuál
  // sigue, para retomar desde ahí al volver a entrar.
  useEffect(() => {
    if (!items || n === 0 || width === 0) return;
    const at = ((index % n) + n) % n;
    const current = new Set(items.map((p) => p.id));
    const seen = new Set([...readSeen()].filter((id) => current.has(id)));
    const count = moves ? Math.min(visible, n) : n;
    for (let j = 0; j < count; j++) seen.add(items[(at + j) % n].id);
    writeSeen(seen, items[(at + count) % n].id);
  }, [items, index, n, width, visible, moves]);

  function moveBy(k: number) {
    if (!moves || k === 0) return;
    setAnimate(true);
    // La fila está repetida 3 veces, así que se puede avanzar o retroceder
    // hasta una vuelta entera sin que se vea el borde.
    setIndex((i) => {
      const base = ((i % n) + n) % n;
      return base + Math.max(-n, Math.min(n, k));
    });
  }

  function onPointerDown(e: React.PointerEvent) {
    if (!moves) return;
    if (e.pointerType === "mouse" && e.button !== 0) return;
    drag.current = { x: e.clientX, y: e.clientY, active: true, moved: false };
    // Si venía de una vuelta sin acomodar, se acomoda ya para arrastrar
    // desde la fila original.
    setAnimate(false);
    setIndex((i) => ((i % n) + n) % n);
  }
  function onPointerMove(e: React.PointerEvent) {
    const d = drag.current;
    if (!d?.active) return;
    const dx = e.clientX - d.x;
    const dy = e.clientY - d.y;
    // Si el movimiento es más vertical, es scroll de la página: se suelta.
    if (!d.moved && Math.abs(dy) > Math.abs(dx) && Math.abs(dy) > 8) {
      drag.current = null;
      setDragDx(0);
      return;
    }
    if (Math.abs(dx) > 6) d.moved = true;
    if (d.moved) setDragDx(dx);
  }
  function endDrag() {
    const d = drag.current;
    drag.current = null;
    if (!d?.active) return;
    const dx = dragDx;
    setDragDx(0);
    if (d.moved) {
      justDragged.current = true;
      setTimeout(() => { justDragged.current = false; }, 50);
    }
    if (Math.abs(dx) >= SWIPE_MIN_PX) {
      // Un empujón corto pasa 1; arrastrar más lejos pasa varias.
      const steps = Math.max(1, Math.round(Math.abs(dx) / STEP));
      moveBy(dx < 0 ? steps : -steps);
    } else {
      setAnimate(true);
    }
    setTouchTick((t) => t + 1);
  }

  if (!items || n === 0) return null;

  const track = moves ? [...items, ...items, ...items] : items;
  // Se muestra la copia del medio, así hay tarjetas a ambos lados.
  const offset = moves ? n + index : 0;

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
              <button type="button" aria-label="Anterior" className="w-7 h-7 rounded-full border border-rule flex items-center justify-center text-steel hover:text-ink hover:border-teal cursor-pointer" onClick={() => { moveBy(-1); setTouchTick((t) => t + 1); }}>
                <ChevronLeft size={15} />
              </button>
              <button type="button" aria-label="Siguiente" className="w-7 h-7 rounded-full border border-rule flex items-center justify-center text-steel hover:text-ink hover:border-teal cursor-pointer" onClick={() => { moveBy(1); setTouchTick((t) => t + 1); }}>
                <ChevronRight size={15} />
              </button>
            </>
          )}
          {listUrl && <Link href={listUrl} className="text-[11px] font-bold text-blue">Ver todos →</Link>}
        </div>
      </div>

      <div
        ref={viewportRef}
        className="overflow-hidden select-none"
        style={{ touchAction: "pan-y" }}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={endDrag}
        onPointerCancel={endDrag}
        onPointerLeave={endDrag}
        // Tras arrastrar no se abre la tarjeta donde se soltó el dedo.
        onClickCapture={(e) => { if (justDragged.current) { e.preventDefault(); e.stopPropagation(); } }}
      >
        <div
          className="flex"
          style={{
            gap: GAP,
            transform: `translateX(${-offset * STEP + dragDx}px)`,
            transition: animate && dragDx === 0 ? `transform ${SLIDE_MS}ms ease-in-out` : "none",
          }}
        >
          {track.map((p, i) => (
            <a
              key={`${p.id}-${i}`}
              href={listUrl ?? undefined}
              draggable={false}
              className={`shrink-0 rounded-md border border-rule bg-cloud overflow-hidden ${listUrl ? "hover:border-teal" : ""}`}
              style={{ width: CARD_W }}
            >
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img loading="lazy" decoding="async" src={p.imageUrl} alt={p.productName} draggable={false} className="w-full object-cover bg-white" style={{ height: CARD_W }} />
              <div className="px-2.5 py-2">
                <div className="text-[16px] font-bold text-teal leading-tight">
                  {p.competitorPrice !== null ? `$${p.competitorPrice.toFixed(2)}` : "Sin precio"}
                  {p.competitorPrice !== null && <span className="text-[10.5px] font-semibold text-steel ml-1">competencia</span>}
                </div>
                <div className="text-[13px] text-ink leading-snug mt-0.5 line-clamp-2 min-h-[2.5em] first-letter:uppercase">{p.productName}</div>
                <div className="text-[11px] text-steel mt-1 min-h-[2.8em] leading-snug">
                  {maxBuyLabel(p.competitorPrice)}
                </div>
              </div>
            </a>
          ))}
        </div>
      </div>
    </div>
  );
}
