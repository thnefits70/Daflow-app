"use client";

import Image from "next/image";
import { useEffect, useMemo, useRef, useState } from "react";
import type { PublicCard, PublicStats } from "@/lib/provedixPublic";
import type { SnapshotProduct } from "@/lib/provedixSnapshot";
import { PvxPhoto } from "@/components/pvx/PvxPhoto";
import { PvxRegister } from "@/components/pvx/PvxRegister";
import { DropiLink, PvxProductDetail } from "@/components/pvx/PvxProductDetail";
import { PvxSalesCurve } from "@/components/pvx/PvxSalesCurve";
import { AdvisorPicker, WhatsAppButton } from "@/components/pvx/PvxContact";
import { PvxRocketSku } from "@/components/pvx/PvxRocketSku";
import { PvxCities, PvxOperation, PvxResources } from "@/components/pvx/PvxSections";
import { IconFacebook, IconInstagram, IconTikTok } from "@/components/pvx/PvxIcons";
import { IconArrow, IconBox, IconCheck, IconClock, IconCopy, IconFlame, IconImage, IconLock, IconSearch, IconSpark, IconTruck, IconWhatsApp } from "@/components/pvx/PvxIcons";

const BRAND = { MKT_PROVEDIX: "Provedix", MKT_DAMIAN: "Importadora Damián" } as const;
type BrandFilter = "ALL" | keyof typeof BRAND;
const PAGE = 24;

function norm(s: string) {
  return s
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase();
}

// Búsqueda por palabras clave (2026-10-12): cada palabra tiene que estar en
// el nombre, la marca o los IDs (Dropi o Rocket), en cualquier orden, sin
// importar tildes ni mayúsculas, y acepta plurales ("almohadas" encuentra
// "almohada").
function matches(c: PublicCard, words: string[]): boolean {
  const hay = norm(`${c.name} ${BRAND[c.brand]} ${c.code} ${(c.rocketSkus ?? []).join(" ")}`);
  return words.every((w) => {
    if (hay.includes(w)) return true;
    if (w.length > 4 && w.endsWith("es") && hay.includes(w.slice(0, -2))) return true;
    return w.length > 3 && w.endsWith("s") && hay.includes(w.slice(0, -1));
  });
}

function scrollToCatalog() {
  document.getElementById("productos")?.scrollIntoView({ behavior: "smooth", block: "start" });
}

// Mini gráfica de ventas día a día en cada tarjeta (pedido 2026-10-12, idea
// tipo DropKiller): 7 o 30 días, sin cifras ni fechas. Difuminada hasta que
// la persona se registra con nombre + WhatsApp — se ve que hay movimiento,
// no cuánto. Los valores ya son relativos (0–100), nunca unidades.
function CardMetrics({ curve, unlocked, onUnlock }: { curve: number[]; unlocked: boolean; onUnlock: () => void }) {
  const [days, setDays] = useState<7 | 30>(7);
  const slice = days === 7 ? curve.slice(-7) : curve;
  const max = Math.max(...slice, 1);
  const values = slice.map((v) => Math.round((v / max) * 100));
  return (
    <div className="mt-3 rounded-xl bg-white p-2" onClick={(e) => e.stopPropagation()}>
      <div className="flex items-center justify-between gap-2">
        <span className="truncate text-[11.5px] font-semibold text-[var(--pvx-ink-2)]">Ventas<span className="hidden min-[420px]:inline"> día a día</span></span>
        <div className="flex rounded-full bg-[var(--pvx-paper-2)] p-0.5">
          {([7, 30] as const).map((d) => (
            <button
              key={d}
              type="button"
              onClick={() => setDays(d)}
              className={`pvx-press whitespace-nowrap rounded-full px-2 py-0.5 text-[11px] font-bold cursor-pointer ${days === d ? "bg-[var(--pvx-ink)] text-white" : "text-[var(--pvx-ink-2)]"}`}
            >
              {d}d
            </button>
          ))}
        </div>
      </div>
      <div className="relative mt-1.5">
        <div className={unlocked ? "" : "blur-[5px] select-none pointer-events-none"} aria-hidden={!unlocked}>
          <PvxSalesCurve values={values} height={44} labels={false} />
        </div>
        {!unlocked && (
          <button type="button" onClick={onUnlock} className="absolute inset-0 grid place-items-center cursor-pointer">
            <span className="inline-flex items-center gap-1 whitespace-nowrap rounded-full bg-[var(--pvx-ink)] px-2.5 py-1 text-[11px] font-bold text-white">
              <IconLock className="w-3 h-3" /> Regístrate y míralo
            </span>
          </button>
        )}
      </div>
    </div>
  );
}

// ID de Dropi en la tarjeta: siempre en una sola línea (en celular la
// tarjeta es angosta y "ID 132006 Copiar" se partía); copiar con un ícono.
function CardDropiId({ code }: { code: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <button
      type="button"
      onClick={(e) => {
        e.stopPropagation();
        navigator.clipboard?.writeText(code).then(() => {
          setCopied(true);
          setTimeout(() => setCopied(false), 1800);
        });
      }}
      title="Copiar ID"
      className="pvx-press flex w-full items-center justify-between gap-1 whitespace-nowrap rounded-full bg-white px-3 py-1.5 hover:bg-[var(--pvx-orange-soft)] cursor-pointer"
    >
      <span className="text-[11px] font-bold text-[var(--pvx-ink-3)]">Dropi</span>
      <span className="pvx-num text-[13px] font-bold tracking-wide text-[var(--pvx-ink)]">{code}</span>
      <span className="text-[var(--pvx-orange-text)]">{copied ? <IconCheck className="w-3.5 h-3.5" /> : <IconCopy className="w-3.5 h-3.5" />}</span>
    </button>
  );
}

function Badges({ c }: { c: PublicCard }) {
  return (
    <>
      {c.stock === "new" && (
        <span className="inline-flex items-center gap-1 rounded-full bg-[var(--pvx-green)] px-2 py-0.5 text-[10.5px] font-bold text-white">
          <IconSpark className="w-3 h-3" /> Nuevo stock
        </span>
      )}
      {c.trend === "up" && (
        <span className="inline-flex items-center gap-1 rounded-full bg-[var(--pvx-orange)] px-2 py-0.5 text-[10.5px] font-bold text-white">
          <IconFlame className="w-3 h-3" /> En subida
        </span>
      )}
    </>
  );
}

// ---- Portada ----------------------------------------------------------------

function Nav({ name }: { name: string | null }) {
  return (
    <nav className="mx-auto flex max-w-[1240px] items-center justify-between gap-4 px-4 pt-5 sm:px-8 sm:pt-7" aria-label="Principal">
      <a href="#" aria-label="Provedix, inicio" className="shrink-0">
        <Image src="/pvx/brand/wordmark-white.png" alt="Provedix" width={720} height={135} priority className="h-[22px] w-auto sm:h-[26px]" />
      </a>
      <div className="flex items-center gap-1 sm:gap-6">
        <a href="#como-funciona" className="hidden text-[14px] font-semibold text-white/75 hover:text-white md:inline">
          Cómo funciona
        </a>
        <a href="#cortes" className="hidden text-[14px] font-semibold text-white/75 hover:text-white md:inline">
          Cortes
        </a>
        <a href="#recursos" className="hidden text-[14px] font-semibold text-white/75 hover:text-white lg:inline">
          Recursos
        </a>
        <a href="#productos" className="hidden text-[14px] font-semibold text-white/75 hover:text-white md:inline">
          Productos
        </a>
        {name ? (
          <span className="text-[13px] font-semibold text-white/80">Hola, {name.split(" ")[0]}</span>
        ) : (
          <a
            href="#productos"
            className="pvx-press inline-flex items-center gap-1.5 rounded-full bg-[var(--pvx-orange)] px-4 py-2 text-[13.5px] font-bold text-white hover:bg-[var(--pvx-orange-press)]"
          >
            Ver productos <IconArrow className="w-3.5 h-3.5" />
          </a>
        )}
      </div>
    </nav>
  );
}

// Titular en dos líneas fijas (regla: nunca más de dos en computadora).
const HEADLINE: string[][] = [
  ["Vende", "lo", "que", "ya"],
  ["se", "está", "vendiendo"],
];

// Lo único "vivo" de la portada: escribes y ves al instante cuánto se vende
// de ese producto — datos reales del resumen, sin registrarse.
function HeroSearch({ cards, query, onQuery, onOpen }: { cards: PublicCard[]; query: string; onQuery: (v: string) => void; onOpen: (code: string) => void }) {
  const [focused, setFocused] = useState(false);
  const boxRef = useRef<HTMLDivElement>(null);
  const words = norm(query.trim()).split(/\s+/).filter(Boolean);
  const results = words.length && query.trim().length >= 2 ? cards.filter((c) => matches(c, words)) : [];
  const open = focused && query.trim().length >= 2;

  useEffect(() => {
    if (!focused) return;
    const close = (e: PointerEvent) => {
      if (boxRef.current && !boxRef.current.contains(e.target as Node)) setFocused(false);
    };
    document.addEventListener("pointerdown", close);
    return () => document.removeEventListener("pointerdown", close);
  }, [focused]);

  return (
    <div ref={boxRef} className="relative w-full max-w-[560px]">
      <form
        role="search"
        onSubmit={(e) => {
          e.preventDefault();
          setFocused(false);
          scrollToCatalog();
        }}
        className="flex items-center gap-2 rounded-full bg-white p-1.5 pl-5"
      >
        <IconSearch className="w-5 h-5 shrink-0 text-[var(--pvx-ink-3)]" />
        <label htmlFor="pvx-hero-search" className="sr-only">
          Busca un producto o un ID de Dropi
        </label>
        <input
          id="pvx-hero-search"
          value={query}
          onChange={(e) => {
            onQuery(e.target.value);
            setFocused(true);
          }}
          onFocus={() => setFocused(true)}
          placeholder="Busca: candado, almohada…"
          autoComplete="off"
          className="min-w-0 flex-1 bg-transparent py-2 text-[16px] text-[var(--pvx-ink)] outline-none placeholder:text-[var(--pvx-ink-3)]"
        />
        <button type="submit" className="pvx-press shrink-0 rounded-full bg-[var(--pvx-orange)] px-4 py-2.5 text-[14px] font-bold text-white hover:bg-[var(--pvx-orange-press)] sm:px-5">
          Buscar
        </button>
      </form>
      {open && (
        <div className="pvx-pop absolute left-0 right-0 top-full z-30 mt-2 overflow-hidden rounded-3xl bg-white text-[var(--pvx-ink)] shadow-[0_24px_60px_-20px_rgb(0_0_0/0.6)]">
          {results.length === 0 ? (
            <div className="px-5 py-4 text-[14px] text-[var(--pvx-ink-2)]">Ese producto todavía no está entre los que más se venden. Prueba con otra palabra.</div>
          ) : (
            <ul>
              {results.slice(0, 5).map((c) => (
                <li key={c.code}>
                  <button
                    type="button"
                    onClick={() => {
                      setFocused(false);
                      onOpen(c.code);
                    }}
                    className="flex w-full items-center gap-3 px-3 py-2 text-left hover:bg-[var(--pvx-paper-2)] cursor-pointer"
                  >
                    <span className="relative h-11 w-11 shrink-0 overflow-hidden rounded-lg bg-[var(--pvx-paper-2)]">
                      <PvxPhoto src={c.photo} alt="" sizes="44px" />
                    </span>
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-[14px] font-semibold">{c.name}</span>
                      <span className="block text-[12.5px] text-[var(--pvx-ink-2)]">
                        <b className="text-[var(--pvx-ink)]">{c.soldRange}</b> vendidos · {c.unitsRange} unidades en 30 días
                      </span>
                    </span>
                    <span className="pvx-num shrink-0 text-[13px] font-extrabold italic text-[var(--pvx-orange-text)]">#{c.rank}</span>
                  </button>
                </li>
              ))}
            </ul>
          )}
          {results.length > 0 && (
            <button
              type="button"
              onClick={() => {
                setFocused(false);
                scrollToCatalog();
              }}
              className="flex w-full items-center justify-center gap-1.5 bg-[var(--pvx-paper-2)] px-4 py-3 text-[13.5px] font-bold text-[var(--pvx-ink)] hover:bg-[var(--pvx-paper-3)] cursor-pointer"
            >
              Ver {results.length === 1 ? "el resultado" : `los ${results.length} resultados`} en el catálogo <IconArrow className="w-3.5 h-3.5" />
            </button>
          )}
        </div>
      )}
    </div>
  );
}

function MarqueeItem({ c, onOpen, hidden }: { c: PublicCard; onOpen: (code: string) => void; hidden?: boolean }) {
  return (
    <button
      type="button"
      tabIndex={hidden ? -1 : 0}
      aria-hidden={hidden}
      onClick={() => onOpen(c.code)}
      className="group mr-3 flex w-[248px] shrink-0 items-center gap-3 rounded-2xl bg-[var(--pvx-night-2)] p-2 pr-4 text-left hover:bg-[var(--pvx-night-3)] cursor-pointer sm:mr-4 sm:w-[300px]"
    >
      <span className="relative h-[72px] w-[72px] shrink-0 overflow-hidden rounded-xl bg-white sm:h-[84px] sm:w-[84px]">
        <PvxPhoto src={c.photo} alt={hidden ? "" : c.name} sizes="84px" />
      </span>
      <span className="min-w-0">
        <span className="pvx-num block text-[13px] font-extrabold italic text-[var(--pvx-orange)]">#{c.rank} más vendido</span>
        <span className="mt-0.5 block truncate text-[13.5px] font-semibold text-white">{c.name}</span>
        <span className="mt-0.5 block text-[12.5px] text-white/65">{c.soldRange} vendidos</span>
      </span>
    </button>
  );
}

// Cinta de productos reales (los más vendidos con foto), en dos filas que
// avanzan en sentidos contrarios. Con "menos movimiento" queda quieta y se
// desliza con el dedo.
function ProductMarquee({ cards, onOpen }: { cards: PublicCard[]; onOpen: (code: string) => void }) {
  const withPhoto = cards.filter((c) => c.photo).slice(0, 20);
  if (withPhoto.length < 6) return null;
  const rows = [withPhoto.filter((_, i) => i % 2 === 0), withPhoto.filter((_, i) => i % 2 === 1)];
  return (
    <div className="flex flex-col gap-3 sm:gap-4" aria-label="Productos más vendidos">
      {rows.map((row, r) => (
        <div key={r} className="pvx-marquee overflow-hidden">
          <div className="pvx-marquee-track" data-dir={r === 1 ? "right" : "left"}>
            {row.map((c) => (
              <MarqueeItem key={c.code} c={c} onOpen={onOpen} />
            ))}
            {row.map((c) => (
              <MarqueeItem key={`${c.code}-b`} c={c} onOpen={onOpen} hidden />
            ))}
          </div>
        </div>
      ))}
    </div>
  );
}

function Stats({ stats }: { stats: PublicStats }) {
  const rows = [
    { value: String(stats.products), label: "productos con ventas reales" },
    stats.orders ? { value: stats.orders, label: "pedidos despachados en 30 días" } : null,
    stats.cities ? { value: stats.cities, label: "destinos de Ecuador con entregas" } : null,
    stats.newProducts > 0 ? { value: String(stats.newProducts), label: stats.newProducts === 1 ? "producto nuevo este mes" : "productos nuevos este mes" } : null,
  ].filter((r): r is { value: string; label: string } => !!r);
  if (!stats.products) return null;
  return (
    <dl className="mx-auto grid max-w-[1240px] grid-cols-2 gap-x-6 gap-y-8 px-4 sm:px-8 lg:grid-cols-4">
      {rows.map((r, i) => (
        <div key={r.label} data-r style={{ ["--d" as string]: i }}>
          <dt className="sr-only">{r.label}</dt>
          <dd>
            <span className="pvx-display pvx-num block whitespace-nowrap text-[44px] text-[var(--pvx-orange)] sm:text-[clamp(44px,4.4vw,64px)]">{r.value}</span>
            <span className="mt-2 block max-w-[220px] text-[15px] leading-snug text-white/75 sm:text-[16px]">{r.label}</span>
          </dd>
        </div>
      ))}
    </dl>
  );
}

function Hero({ cards, stats, name, query, onQuery, onOpen }: { cards: PublicCard[]; stats: PublicStats; name: string | null; query: string; onQuery: (v: string) => void; onOpen: (code: string) => void }) {
  return (
    <header className="relative overflow-hidden bg-[var(--pvx-night)] text-white">
      {/* El cubo del logo, enorme y recortado, como sello de fondo. */}
      <Image
        src="/pvx/brand/mark-white.png"
        alt=""
        width={360}
        height={403}
        aria-hidden
        className="pvx-drop pointer-events-none absolute -right-16 top-28 hidden w-[480px] opacity-[0.06] lg:block"
      />
      <Nav name={name} />
      <div className="relative mx-auto max-w-[1240px] px-4 pt-14 sm:px-8 sm:pt-24">
        <h1 className="pvx-display text-[34px] sm:text-[clamp(52px,6.6vw,96px)]">
          {HEADLINE.map((line, l) => (
            <span key={l} className={`block ${l === 1 ? "text-[var(--pvx-orange)]" : ""}`}>
              {line.map((w, i) => (
                <span key={w} className="pvx-rise" style={{ ["--i" as string]: l * 4 + i }}>
                  {w}
                  {i < line.length - 1 ? " " : ""}
                </span>
              ))}
            </span>
          ))}
        </h1>
        <p className="mt-8 max-w-[580px] text-[17px] leading-relaxed text-white/80 sm:mt-10 sm:text-[19px]">
          Los productos de Provedix con ventas reales en Ecuador: cuánto se vende, a qué precio y en qué ciudades. Gratis, con el ID de Dropi listo para copiar.
        </p>
        <div className="mt-7">
          <HeroSearch cards={cards} query={query} onQuery={onQuery} onOpen={onOpen} />
        </div>
        <div className="mt-5">
          <AdvisorPicker
            dark
            className="inline-flex items-center gap-2 text-left text-[14.5px] font-semibold text-white/75 underline decoration-white/30 underline-offset-4 hover:text-white hover:decoration-[var(--pvx-orange)] cursor-pointer"
          >
            <IconWhatsApp className="w-4.5 h-4.5 shrink-0 text-[#3ddc84]" /> ¿Dudas? Escríbele a un asesor por WhatsApp
          </AdvisorPicker>
        </div>
      </div>
      <div className="relative mt-14 sm:mt-20">
        <ProductMarquee cards={cards} onOpen={onOpen} />
      </div>
      <div className="relative py-16 sm:py-24">
        <Stats stats={stats} />
      </div>
    </header>
  );
}

// ---- Cómo funciona -------------------------------------------------------------

function Steps({ top }: { top: PublicCard | undefined }) {
  const steps = [
    {
      title: "Elige un ganador",
      text: "Mira qué se vende, a qué precio y en qué ciudades. Los datos salen de nuestros despachos reales, no de suposiciones.",
      ui: top ? (
        <div data-ui className="flex items-center gap-3 rounded-2xl bg-white p-2.5 pr-4">
          <span className="relative h-14 w-14 shrink-0 overflow-hidden rounded-xl bg-[var(--pvx-paper-2)]">
            <PvxPhoto src={top.photo} alt="" sizes="56px" />
          </span>
          <span className="min-w-0">
            <span className="pvx-num block text-[12px] font-extrabold italic text-[var(--pvx-orange-text)]">#{top.rank} más vendido</span>
            <span className="block truncate text-[14px] font-semibold">{top.name}</span>
            <span className="block text-[12.5px] text-[var(--pvx-ink-2)]">{top.soldRange} vendidos en 30 días</span>
          </span>
        </div>
      ) : null,
    },
    {
      title: "Copia el ID y publícalo en Dropi",
      text: "Cada producto trae su ID de Dropi, y su SKU de Rocket si lo tiene. Un clic para copiarlo, otro para abrirlo en Dropi.",
      ui: top ? (
        <div data-ui className="flex flex-wrap items-center gap-2">
          <span className="inline-flex items-center gap-2 rounded-full bg-white px-4 py-2.5">
            <span className="text-[12px] font-bold text-[var(--pvx-ink-3)]">Dropi</span>
            <span className="pvx-num text-[15px] font-bold tracking-wide">{top.code}</span>
            <IconCopy className="w-4 h-4 text-[var(--pvx-orange-text)]" />
          </span>
          <span className="inline-flex items-center gap-1.5 rounded-full bg-[var(--pvx-orange)] px-4 py-2.5 text-[13.5px] font-bold text-white">
            Ver en Dropi <IconArrow className="w-3.5 h-3.5" />
          </span>
        </div>
      ) : null,
    },
    {
      title: "Vende. Nosotros despachamos",
      text: "Tú consigues la venta. Nosotros lo preparamos en el siguiente corte y sale en menos de 3 horas.",
      ui: (
        <div data-ui className="inline-flex items-center gap-3 rounded-2xl bg-white p-2.5 pr-5">
          <span className="grid h-14 w-14 place-items-center rounded-xl bg-[var(--pvx-ink)] text-[var(--pvx-orange)]">
            <IconTruck className="w-7 h-7" />
          </span>
          <span>
            <span className="block text-[12px] font-bold text-[var(--pvx-green)]">Pedido despachado</span>
            <span className="block text-[15px] font-bold">Sale en menos de 3 horas</span>
          </span>
        </div>
      ),
    },
  ];
  return (
    <section id="como-funciona" className="scroll-mt-4 bg-[var(--pvx-paper)] py-24 sm:py-36" aria-labelledby="pvx-how">
      <div className="mx-auto max-w-[1240px] px-4 sm:px-8">
        <h2 id="pvx-how" data-r className="pvx-display max-w-[760px] text-[38px] sm:text-[64px]">
          De la idea a tu <span className="text-[var(--pvx-orange)]">primera venta</span>
        </h2>
        <ol className="mt-14 grid gap-5 sm:mt-20 lg:grid-cols-3">
          {steps.map((s, i) => (
            <li key={s.title} data-r style={{ ["--d" as string]: i }} className="flex flex-col rounded-[28px] bg-[var(--pvx-paper-2)] p-6 sm:p-8">
              <div className="min-h-[76px]">{s.ui}</div>
              <h3 className="pvx-heading mt-10 text-[24px] sm:text-[28px]">{s.title}</h3>
              <p className="mt-3 text-[16px] leading-relaxed text-[var(--pvx-ink-2)]">{s.text}</p>
            </li>
          ))}
        </ol>
      </div>
    </section>
  );
}

// ---- Promesas (franja naranja) -------------------------------------------------

function Promises() {
  const rows = [
    { icon: <IconClock className="w-7 h-7" />, title: "Más de 3 cortes diarios", text: "Imprimimos guías varias veces al día para que tu pedido salga apenas ingresa." },
    { icon: <IconTruck className="w-7 h-7" />, title: "Despacho en menos de 3 horas", text: "Del corte a la transportadora en menos de 3 horas. Menos espera, menos devoluciones." },
    { icon: <IconImage className="w-7 h-7" />, title: "Fotos brandeadas listas", text: "Fotos del producto listas para tus anuncios y tu tienda." },
    { icon: <IconWhatsApp className="w-7 h-7" />, title: "Un asesor por WhatsApp", text: "Una persona real te ayuda a elegir y resuelve tus dudas." },
  ];
  // Titular arriba a todo el ancho y las promesas en cuadrícula (2026-10-13:
  // "despachamos" quedaba pegado a los íconos en la versión de dos columnas).
  return (
    <section className="bg-[var(--pvx-orange)] py-24 text-white sm:py-32" aria-labelledby="pvx-promise">
      <div className="mx-auto max-w-[1240px] px-4 sm:px-8">
        <div data-r className="flex flex-col items-start gap-8">
          <h2 id="pvx-promise" className="pvx-display text-[38px] sm:text-[clamp(44px,5.2vw,76px)]">
            <span className="block">Tú vendes.</span>
            <span className="block text-[var(--pvx-ink)]">Nosotros despachamos.</span>
          </h2>
          <AdvisorPicker className="pvx-press inline-flex items-center gap-2 whitespace-nowrap rounded-full bg-white px-6 py-3.5 text-[15px] font-bold text-[var(--pvx-ink)] hover:bg-[var(--pvx-ink)] hover:text-white cursor-pointer">
            <IconWhatsApp className="w-5 h-5" /> Escribir al asesor
          </AdvisorPicker>
        </div>
        <ul className="mt-14 grid gap-4 sm:mt-20 sm:grid-cols-2 lg:grid-cols-4">
          {rows.map((r, i) => (
            <li key={r.title} data-r style={{ ["--d" as string]: i + 1 }} className="flex flex-col rounded-[24px] bg-white/[.12] p-6 sm:p-7">
              <span className="grid h-14 w-14 place-items-center rounded-2xl bg-[var(--pvx-ink)] text-[var(--pvx-orange)]">{r.icon}</span>
              <span className="pvx-heading mt-8 block text-[23px] lg:text-[22px] xl:text-[24px]">{r.title}</span>
              <span className="mt-3 block text-[16px] leading-relaxed text-white">{r.text}</span>
            </li>
          ))}
        </ul>
      </div>
    </section>
  );
}

// ---- Catálogo ------------------------------------------------------------------

function FilterChip({ active, onClick, children, tone = "ink" }: { active: boolean; onClick: () => void; children: React.ReactNode; tone?: "ink" | "orange" | "green" }) {
  const on = tone === "orange" ? "bg-[var(--pvx-orange)] text-white" : tone === "green" ? "bg-[var(--pvx-green)] text-white" : "bg-[var(--pvx-ink)] text-white";
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={active}
      className={`pvx-press inline-flex shrink-0 items-center gap-1.5 rounded-full px-3.5 py-2 text-[13px] font-bold cursor-pointer ${active ? on : "bg-[var(--pvx-paper-2)] text-[var(--pvx-ink)] hover:bg-[var(--pvx-paper-3)]"}`}
    >
      {children}
    </button>
  );
}

function ProductCard({ c, index, registered, onOpen }: { c: PublicCard; index: number; registered: boolean; onOpen: (code: string) => void }) {
  return (
    <div
      role="button"
      tabIndex={0}
      onClick={() => onOpen(c.code)}
      onKeyDown={(e) => {
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault();
          onOpen(c.code);
        }
      }}
      className="pvx-card group flex flex-col rounded-[22px] bg-[var(--pvx-paper-2)] p-2 text-left cursor-pointer sm:p-2.5"
    >
      <div className="relative aspect-square overflow-hidden rounded-2xl bg-white">
        <div className="pvx-card-photo absolute inset-0">
          <PvxPhoto src={c.photo} alt={c.name} sizes="(max-width: 768px) 50vw, (max-width: 1024px) 33vw, 25vw" priority={index < 4} />
        </div>
      </div>
      <div className="flex flex-1 flex-col px-1 pt-3 pb-1 sm:px-1.5">
        {/* Puesto y "En subida" fuera de la foto, para no tapar nada de la imagen. */}
        <div className="flex flex-wrap items-center gap-1.5">
          <span className="pvx-num text-[15px] font-black italic text-[var(--pvx-orange-text)]">#{c.rank}</span>
          <Badges c={c} />
          <span className="text-[11.5px] font-semibold text-[var(--pvx-ink-3)]">{BRAND[c.brand]}</span>
        </div>
        <div className="mt-1 line-clamp-2 min-h-[2.6em] text-[14px] font-semibold leading-snug">{c.name}</div>
        <div className="mt-2.5">
          <span className="pvx-heading block text-[19px] sm:text-[21px]">{c.soldRange}</span>
          <span className="block text-[12.5px] text-[var(--pvx-ink-2)]">vendidos · {c.unitsRange} unidades en 30 días</span>
        </div>
        {c.stock === "out" && (
          <div className="mt-2 flex items-start gap-1.5 rounded-xl bg-[#fff4e0] px-2.5 py-1.5 text-[11.5px] font-semibold text-[#8a4b00]">
            <IconClock className="mt-px w-3.5 h-3.5 shrink-0" /> Agotado por ahora · llega más stock. Consulta con el asesor.
          </div>
        )}
        {c.curve && c.curve.some((v) => v > 0) && <CardMetrics curve={c.curve} unlocked={registered} onUnlock={() => onOpen(c.code)} />}
        {/* Mismo orden y alto en todas las tarjetas, también en celular (2026-10-12). */}
        <div className="relative mt-2 flex flex-col gap-1.5">
          <CardDropiId code={c.code} />
          <div className="grid grid-cols-2 gap-1.5">
            <DropiLink code={c.code} compact block />
            <WhatsAppButton p={c} outOfStock={c.stock === "out"} compact block />
          </div>
          {(c.rocketSkus ?? []).slice(0, 1).map((r) => (
            <PvxRocketSku key={r} sku={r} />
          ))}
        </div>
        <div className="mt-auto pt-2.5">
          <div className="flex items-center justify-center gap-1.5 rounded-full bg-[var(--pvx-ink)] px-3 py-2 text-center text-[12.5px] font-bold leading-tight text-white transition-colors duration-200 group-hover:bg-[var(--pvx-orange)]">
            {!registered && <IconLock className="w-3.5 h-3.5 shrink-0" />}
            <span className="min-[420px]:hidden">Precio y ganancia</span>
            <span className="hidden min-[420px]:inline">Precio, ganancia y ciudades</span>
          </div>
        </div>
      </div>
    </div>
  );
}

// ---- Pie -----------------------------------------------------------------------

// Redes y canales de WhatsApp de Provedix (pasados por el usuario 2026-10-13).
export const SOCIAL = [
  { name: "Instagram", url: "https://www.instagram.com/provedix.ec/", icon: <IconInstagram className="w-5 h-5" /> },
  { name: "TikTok", url: "https://www.tiktok.com/@provedix.ec", icon: <IconTikTok className="w-5 h-5" /> },
  { name: "Facebook", url: "https://www.facebook.com/share/1FHzeG3XBR/", icon: <IconFacebook className="w-5 h-5" /> },
];
const WHATSAPP_CHANNELS = [
  { name: "Canal de Provedix", url: "https://whatsapp.com/channel/0029VbCKi9o2P59fQXV5Hf30" },
  { name: "Canal de Importadora Damián", url: "https://whatsapp.com/channel/0029Vb7M5b0FnSzGabyN9016" },
];

function Footer() {
  return (
    <footer className="bg-[var(--pvx-night)] text-white">
      <div className="mx-auto max-w-[1240px] px-4 pt-20 pb-10 sm:px-8 sm:pt-28">
        <div className="flex flex-col gap-8 sm:flex-row sm:items-end sm:justify-between">
          <p className="pvx-heading max-w-[560px] text-[28px] sm:text-[40px]">¿Listo para vender lo que ya funciona?</p>
          <div className="flex flex-wrap gap-3">
            <a href="#productos" className="pvx-press inline-flex items-center gap-2 rounded-full bg-[var(--pvx-orange)] px-6 py-3.5 text-[15px] font-bold text-white hover:bg-[var(--pvx-orange-press)]">
              Ver productos <IconArrow className="w-4 h-4" />
            </a>
            <AdvisorPicker up dark alignRight className="pvx-press inline-flex items-center gap-2 rounded-full bg-white/10 px-6 py-3.5 text-[15px] font-bold text-white hover:bg-white/15 cursor-pointer">
              <IconWhatsApp className="w-4.5 h-4.5 text-[#3ddc84]" /> Asesor
            </AdvisorPicker>
          </div>
        </div>
        <div className="mt-16 grid gap-8 rounded-[28px] bg-white/[.05] p-6 sm:p-8 lg:grid-cols-2 lg:items-center">
          <div>
            <p className="pvx-heading text-[24px] sm:text-[28px]">Productos nuevos, primero en tu WhatsApp</p>
            <p className="mt-2 text-[15px] leading-relaxed text-white/70">Únete a nuestros canales y entérate antes que nadie de lo que llega y de lo que se está vendiendo.</p>
            <div className="mt-5 flex flex-wrap gap-2">
              {WHATSAPP_CHANNELS.map((c) => (
                <a
                  key={c.url}
                  href={c.url}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="pvx-press inline-flex items-center gap-2 whitespace-nowrap rounded-full bg-[#138a45] px-5 py-3 text-[14.5px] font-bold text-white hover:bg-[#0f7239]"
                >
                  <IconWhatsApp className="w-5 h-5" /> {c.name}
                </a>
              ))}
            </div>
          </div>
          <div className="lg:justify-self-end">
            <p className="text-[15px] font-semibold text-white/70">Síguenos</p>
            <ul className="mt-3 flex flex-wrap gap-2">
              {SOCIAL.map((s) => (
                <li key={s.name}>
                  <a
                    href={s.url}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="pvx-press inline-flex items-center gap-2 rounded-full bg-white/10 px-4 py-3 text-[14.5px] font-bold text-white hover:bg-[var(--pvx-orange)]"
                  >
                    {s.icon} {s.name}
                  </a>
                </li>
              ))}
            </ul>
            <p className="mt-3 text-[13.5px] text-white/50">@provedix.ec</p>
          </div>
        </div>
        <Image src="/pvx/brand/wordmark-tagline-white.png" alt="Provedix · Conectando productos y oportunidades" width={1600} height={374} className="mt-20 h-auto w-full" />
        <div className="mt-10 grid gap-4 text-[13px] leading-relaxed text-white/60 sm:grid-cols-2">
          <p>Provedix · Importadora Damián — Guayaquil, Ecuador.</p>
          <p>
            Los datos salen de los despachos reales de nuestras bodegas y se muestran en rangos. No mostramos datos de clientes ni de tiendas. Si te registras, guardamos tu
            nombre, WhatsApp, tienda, plataforma y correo (si lo das) solo para enviarte productos ganadores y atenderte mejor; puedes pedir que los
            borremos cuando quieras.
          </p>
        </div>
      </div>
    </footer>
  );
}

// Página pública de provedix.com (etapa 3, pedido del usuario 2026-10-12;
// rediseño completo 2026-10-13): portada oscura con buscador en vivo, cinta
// de productos y números reales; cómo funciona; promesas; catálogo blanco.
// Ver la ficha completa pide registrarse una vez (nombre + WhatsApp).
export function PvxCatalog({ cards, stats }: { cards: PublicCard[]; stats: PublicStats }) {
  const [registered, setRegistered] = useState<boolean | null>(null);
  const [name, setName] = useState<string | null>(null);
  const [query, setQuery] = useState("");
  const [brand, setBrand] = useState<BrandFilter>("ALL");
  const [hotOnly, setHotOnly] = useState(false);
  const [newOnly, setNewOnly] = useState(false);
  const [shown, setShown] = useState(PAGE);
  const [open, setOpen] = useState<{ code: string; mode: "register" | "loading" | "detail" | "error"; product?: SnapshotProduct } | null>(null);
  const searchTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const rootRef = useRef<HTMLDivElement>(null);

  // La visita se cuenta una vez al abrir la página.
  useEffect(() => {
    let alive = true;
    fetch("/api/pvx/visit", { method: "POST" })
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => {
        if (!alive) return;
        setRegistered(!!d?.registered);
        setName(d?.name ?? null);
      })
      .catch(() => alive && setRegistered(false));
    return () => {
      alive = false;
    };
  }, []);

  // Entrada de las secciones al aparecer en pantalla. Si el script no corre,
  // todo se ve igual (el CSS solo esconde con data-reveal="on").
  useEffect(() => {
    const root = rootRef.current?.closest(".pvx") as HTMLElement | null;
    if (!root || !("IntersectionObserver" in window)) return;
    root.dataset.reveal = "on";
    // Protección: si el navegador no avisa nada en 2 s (pestaña en segundo
    // plano, navegador raro), se muestra todo sin animación.
    let fired = false;
    const fallback = setTimeout(() => {
      if (!fired) delete root.dataset.reveal;
    }, 2000);
    const io = new IntersectionObserver(
      (entries) => {
        fired = true;
        for (const e of entries) {
          if (e.isIntersecting) {
            e.target.classList.add("is-in");
            io.unobserve(e.target);
          }
        }
      },
      { rootMargin: "0px 0px -8% 0px" },
    );
    root.querySelectorAll("[data-r]").forEach((el) => io.observe(el));
    return () => {
      clearTimeout(fallback);
      io.disconnect();
    };
  }, []);

  // Se anota qué busca (cuando deja de escribir), para la cartera.
  function onSearch(v: string) {
    setQuery(v);
    setShown(PAGE);
    if (searchTimer.current) clearTimeout(searchTimer.current);
    const q = v.trim();
    if (q.length < 3) return;
    searchTimer.current = setTimeout(() => {
      fetch("/api/pvx/search", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ query: q }) }).catch(() => null);
    }, 1500);
  }

  // Si lo buscado existe pero los botones de marca / "En subida" lo
  // esconden, se muestra igual con un aviso (caso 103053 con "En subida"
  // prendido, 2026-10-12).
  const { filtered, ignoredFilters } = useMemo(() => {
    const words = norm(query.trim()).split(/\s+/).filter(Boolean);
    const found = words.length ? cards.filter((c) => matches(c, words)) : cards;
    const withFilters = found.filter((c) => (brand === "ALL" || c.brand === brand) && (!hotOnly || c.trend === "up") && (!newOnly || c.stock === "new"));
    // Lo que acaba de volver a tener stock va primero (pedido 2026-10-12:
    // anunciarlo para que se posicione); el resto, en su orden de ventas.
    const ordered = (list: PublicCard[]) => [...list].sort((a, b) => Number(b.stock === "new") - Number(a.stock === "new"));
    if (words.length && withFilters.length === 0 && found.length > 0) return { filtered: ordered(found), ignoredFilters: true };
    return { filtered: ordered(withFilters), ignoredFilters: false };
  }, [cards, query, brand, hotOnly, newOnly]);

  async function loadDetail(code: string) {
    setOpen({ code, mode: "loading" });
    const res = await fetch(`/api/pvx/product/${encodeURIComponent(code)}`).catch(() => null);
    if (res?.status === 401) {
      setRegistered(false);
      setOpen({ code, mode: "register" });
      return;
    }
    const d = res?.ok ? await res.json().catch(() => null) : null;
    setOpen(d?.product ? { code, mode: "detail", product: d.product } : { code, mode: "error" });
  }

  function openCard(code: string) {
    if (registered) loadDetail(code);
    else setOpen({ code, mode: "register" });
  }

  useEffect(() => {
    document.body.style.overflow = open ? "hidden" : "";
    if (!open) return;
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && setOpen(null);
    window.addEventListener("keydown", onKey);
    return () => {
      document.body.style.overflow = "";
      window.removeEventListener("keydown", onKey);
    };
  }, [open]);

  const hotCount = cards.filter((c) => c.trend === "up").length;
  const newCount = cards.filter((c) => c.stock === "new").length;

  return (
    <div ref={rootRef}>
      <Hero cards={cards} stats={stats} name={name} query={query} onQuery={onSearch} onOpen={openCard} />
      <Steps top={cards.find((c) => c.photo) ?? cards[0]} />
      <Promises />
      <PvxOperation />
      <PvxCities stats={stats} />

      <section id="productos" className="scroll-mt-0 bg-[var(--pvx-paper)] pt-24 sm:pt-32" aria-labelledby="pvx-products">
        <div className="mx-auto max-w-[1240px] px-4 sm:px-8">
          <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
            <h2 id="pvx-products" data-r className="pvx-display text-[40px] sm:text-[64px]">
              Productos <span className="text-[var(--pvx-orange)]">ganadores</span>
            </h2>
            <p data-r className="max-w-[360px] text-[15px] leading-relaxed text-[var(--pvx-ink-2)]">
              {cards.length} productos ordenados por ventas de los últimos 30 días.
              {hotCount > 0 ? ` ${hotCount} van en subida.` : ""}
            </p>
          </div>
        </div>

        <div className="sticky top-0 z-20 mt-8 bg-[var(--pvx-paper)]/[.97] shadow-[0_1px_0_var(--pvx-paper-3)]">
          <div className="mx-auto flex max-w-[1240px] flex-col gap-2.5 px-4 py-3 sm:flex-row sm:items-center sm:px-8">
            <label className="flex w-full items-center gap-2 rounded-full bg-[var(--pvx-paper-2)] px-4 focus-within:bg-white focus-within:shadow-[0_0_0_2px_var(--pvx-orange)] sm:max-w-[380px]">
              <IconSearch className="w-4.5 h-4.5 shrink-0 text-[var(--pvx-ink-3)]" />
              <span className="sr-only">Buscar en el catálogo</span>
              <input
                value={query}
                onChange={(e) => onSearch(e.target.value)}
                placeholder="Busca un producto o ID…"
                className="min-w-0 flex-1 bg-transparent py-2.5 text-[16px] outline-none placeholder:text-[var(--pvx-ink-3)]"
              />
            </label>
            <div className="pvx-scroll-x -mx-4 flex gap-2 overflow-x-auto px-4 sm:mx-0 sm:px-0">
              {(["ALL", "MKT_PROVEDIX", "MKT_DAMIAN"] as BrandFilter[]).map((b) => (
                <FilterChip
                  key={b}
                  active={brand === b}
                  onClick={() => {
                    setBrand(b);
                    setShown(PAGE);
                  }}
                >
                  {b === "ALL" ? "Todos" : BRAND[b]}
                </FilterChip>
              ))}
              <FilterChip
                tone="orange"
                active={hotOnly}
                onClick={() => {
                  setHotOnly(!hotOnly);
                  setShown(PAGE);
                }}
              >
                <IconFlame className="w-3.5 h-3.5" /> En subida
              </FilterChip>
              {newCount > 0 && (
                <FilterChip
                  tone="green"
                  active={newOnly}
                  onClick={() => {
                    setNewOnly(!newOnly);
                    setShown(PAGE);
                  }}
                >
                  <IconSpark className="w-3.5 h-3.5" /> Nuevo stock
                </FilterChip>
              )}
            </div>
          </div>
        </div>

        <div className="mx-auto max-w-[1240px] px-4 pt-6 pb-28 sm:px-8 sm:pb-36">
          {cards.length === 0 && (
            <div className="flex flex-col items-center gap-3 py-24 text-center text-[var(--pvx-ink-2)]">
              <IconBox className="w-10 h-10 text-[var(--pvx-orange)]" />
              Muy pronto verás aquí los productos ganadores.
            </div>
          )}
          {cards.length > 0 && filtered.length === 0 && (
            <div className="flex flex-col items-center gap-3 py-20 text-center">
              <IconSearch className="w-9 h-9 text-[var(--pvx-orange)]" />
              <p className="text-[16px] font-semibold">No encontramos productos con esa búsqueda.</p>
              <p className="text-[14px] text-[var(--pvx-ink-2)]">Prueba con otra palabra o pregúntale al asesor si lo tenemos.</p>
            </div>
          )}
          {ignoredFilters && (
            <div className="mb-5 rounded-2xl bg-[var(--pvx-orange-soft)] px-4 py-3 text-[14px]">
              No está entre los filtros que elegiste ({[brand !== "ALL" ? BRAND[brand] : null, hotOnly ? "En subida" : null, newOnly ? "Nuevo stock" : null].filter(Boolean).join(" · ")}), pero
              aquí lo tienes.
            </div>
          )}
          <div className="grid grid-cols-2 gap-2.5 sm:gap-4 md:grid-cols-3 lg:grid-cols-4">
            {filtered.slice(0, shown).map((c, i) => (
              <ProductCard key={c.code} c={c} index={i} registered={registered === true} onOpen={openCard} />
            ))}
          </div>
          {filtered.length > shown && (
            <div className="mt-10 text-center">
              <button
                type="button"
                onClick={() => setShown(shown + PAGE)}
                className="pvx-press inline-flex items-center gap-2 rounded-full bg-[var(--pvx-ink)] px-7 py-3.5 text-[15px] font-bold text-white hover:bg-[var(--pvx-orange)] cursor-pointer"
              >
                Ver más productos <span className="pvx-num text-white/70">({filtered.length - shown})</span>
              </button>
            </div>
          )}
        </div>
      </section>

      <PvxResources />
      <Footer />

      {open && (
        <div className="pvx-overlay fixed inset-0 z-50 flex items-end justify-center bg-black/60 p-0 sm:items-center sm:p-4" onClick={() => setOpen(null)}>
          <div
            role="dialog"
            aria-modal="true"
            className={`pvx-sheet w-full sm:max-w-xl ${open.mode === "detail" ? "md:max-w-5xl" : open.mode === "register" ? "sm:max-w-2xl" : ""} max-h-[94vh] overflow-y-auto rounded-t-[28px] bg-[var(--pvx-paper)] sm:rounded-[28px]`}
            onClick={(e) => e.stopPropagation()}
          >
            {open.mode === "register" && (
              <PvxRegister
                onClose={() => setOpen(null)}
                onDone={(n) => {
                  setRegistered(true);
                  setName(n);
                  loadDetail(open.code);
                }}
              />
            )}
            {open.mode === "loading" && (
              <div className="flex items-center justify-center gap-3 p-12 text-[var(--pvx-ink-2)]">
                <IconBox className="w-6 h-6 animate-pulse text-[var(--pvx-orange)]" /> Abriendo el producto…
              </div>
            )}
            {open.mode === "error" && (
              <div className="p-10 text-center">
                <div className="text-[var(--pvx-ink-2)]">No se pudo abrir este producto. Intenta de nuevo en un momento.</div>
                <button type="button" onClick={() => setOpen(null)} className="mt-4 font-bold text-[var(--pvx-orange-text)] cursor-pointer">
                  Cerrar
                </button>
              </div>
            )}
            {open.mode === "detail" && open.product && <PvxProductDetail p={open.product} onClose={() => setOpen(null)} />}
          </div>
        </div>
      )}
    </div>
  );
}
