"use client";

import Image from "next/image";
import { useEffect, useRef, useState } from "react";
import { IconArrow } from "@/components/pvx/PvxIcons";

// Efectos de provedix.com (pedido del usuario 2026-10-14, ideas de un video de
// Cult UI hechas a mano, sin librerías): números que cuentan, ciudad que va
// cambiando en la portada y barra superior de vidrio al bajar. Todos respetan
// "reducir movimiento" del celular o la computadora.

function reducedMotion(): boolean {
  return typeof window !== "undefined" && window.matchMedia("(prefers-reduced-motion: reduce)").matches;
}

// Número que cuenta desde 0 cuando aparece en pantalla ("+5.000", "215").
// Sin JavaScript (o con menos movimiento) se ve el número final de una vez.
export function CountUp({ value, className }: { value: string; className?: string }) {
  const m = /^(\+?)([\d.]+)$/.exec(value);
  const target = m ? Number(m[2].replace(/\./g, "")) : NaN;
  const [shown, setShown] = useState(value);
  const ref = useRef<HTMLSpanElement>(null);

  useEffect(() => {
    const el = ref.current;
    if (!m || !Number.isFinite(target) || !el || reducedMotion() || !("IntersectionObserver" in window)) return;
    const fmt = (n: number) => `${m[1]}${n.toLocaleString("es-EC")}`;
    let raf = 0;
    const io = new IntersectionObserver(
      ([e]) => {
        if (!e.isIntersecting) return;
        io.disconnect();
        const start = performance.now();
        const dur = 1400;
        const step = (t: number) => {
          const p = Math.min(1, (t - start) / dur);
          const eased = 1 - Math.pow(1 - p, 3);
          setShown(fmt(Math.round(target * eased)));
          if (p < 1) raf = requestAnimationFrame(step);
        };
        raf = requestAnimationFrame(step);
      },
      { threshold: 0.4 },
    );
    io.observe(el);
    return () => {
      io.disconnect();
      cancelAnimationFrame(raf);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [value]);

  return (
    <span ref={ref} className={className} aria-label={value}>
      {shown}
    </span>
  );
}

// "…en Quito" → "…en Guayaquil" → … con las ciudades que más compran (datos
// reales del resumen). Para lectores de pantalla va la lista completa.
export function RotatingCity({ cities }: { cities: string[] }) {
  const [i, setI] = useState(0);
  useEffect(() => {
    if (cities.length < 2 || reducedMotion()) return;
    const t = setInterval(() => setI((x) => (x + 1) % cities.length), 2200);
    return () => clearInterval(t);
  }, [cities.length]);
  if (cities.length === 0) return null;
  return (
    <p className="pvx-heading mt-3 text-[22px] text-white sm:mt-4 sm:text-[clamp(26px,2.8vw,40px)]">
      <span className="sr-only">Se vende en {cities.join(", ")}.</span>
      <span aria-hidden className="inline-flex items-baseline gap-[0.3em]">
        <span className="text-white/60">…en</span>
        <span className="relative inline-block overflow-hidden align-bottom">
          <span key={i} className="pvx-swap inline-block text-[var(--pvx-orange)]">
            {cities[i]}
          </span>
        </span>
      </span>
    </p>
  );
}

// Barra superior de vidrio que aparece al bajar por la página.
export function GlassBar() {
  const [show, setShow] = useState(false);
  useEffect(() => {
    const onScroll = () => setShow(window.scrollY > 560);
    onScroll();
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => window.removeEventListener("scroll", onScroll);
  }, []);
  return (
    <div
      className={`pvx-glass fixed inset-x-0 top-0 z-40 transition-transform duration-300 ease-[cubic-bezier(0.23,1,0.32,1)] motion-reduce:transition-none ${show ? "translate-y-0" : "-translate-y-full"}`}
      aria-hidden={!show}
      inert={!show}
    >
      <div className="mx-auto flex h-[60px] max-w-[1240px] items-center justify-between gap-4 px-4 sm:h-[68px] sm:px-8">
        <a href="#" aria-label="Provedix, inicio" className="shrink-0">
          <Image src="/pvx/brand/wordmark-white.png" alt="Provedix" width={720} height={135} className="h-[18px] w-auto sm:h-[22px]" />
        </a>
        <nav aria-label="Secciones" className="flex items-center gap-1 sm:gap-6">
          <a href="#cortes" className="hidden text-[14px] font-semibold text-white/80 hover:text-white md:inline">
            Cortes
          </a>
          <a href="#recursos" className="hidden text-[14px] font-semibold text-white/80 hover:text-white md:inline">
            Recursos
          </a>
          <a
            href="#productos"
            className="pvx-press pvx-shine inline-flex items-center gap-1.5 rounded-full bg-[var(--pvx-orange)] px-4 py-2 text-[13.5px] font-bold text-white hover:bg-[var(--pvx-orange-press)]"
          >
            Ver productos <IconArrow className="w-3.5 h-3.5" />
          </a>
        </nav>
      </div>
    </div>
  );
}

// Botón para detener la cinta de productos (las animaciones de más de 5 s
// necesitan pausa — regla de Vercel). En celular no hay "pasar el mouse".
export function useMarqueePause() {
  const [paused, setPaused] = useState(false);
  const button = (
    <button
      type="button"
      onClick={() => setPaused(!paused)}
      aria-pressed={paused}
      className="pvx-press inline-flex items-center gap-1.5 rounded-full bg-white/10 px-3 py-1.5 text-[12.5px] font-semibold text-white/80 hover:bg-white/15 hover:text-white cursor-pointer"
    >
      <span aria-hidden className="text-[10px]">
        {paused ? "▶" : "❚❚"}
      </span>
      {paused ? "Mover productos" : "Pausar productos"}
    </button>
  );
  return { paused, button };
}
