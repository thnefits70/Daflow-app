"use client";

import Image from "next/image";
import { useEffect, useState, useSyncExternalStore } from "react";
import type { PublicStats } from "@/lib/provedixPublic";
import type { CarrierStats, CityCarriers } from "@/lib/provedixCarriers";
import { CUTS, cutState, SATURDAY_CARRIERS, type CutState } from "@/lib/pvxCuts";
import { PVX_LINKS } from "@/lib/pvxLinks";
import { ADVISOR_RESPONSE_PROMISE, PVX_FAQ, WORK_HOURS_TEXT } from "@/lib/pvxFaq";
import type { PublicTestimonials } from "@/lib/provedixRatings";
import type { TeamPhoto } from "@/lib/pvxTeamPhotos";
import { IconArrow, IconBox, IconCheck, IconClock, IconExternal, IconImage, IconSpark, IconTrendUp, IconTruck } from "@/components/pvx/PvxIcons";

// Secciones sacadas del "Manual de Trabajo Provedix – Actualizado 2026"
// (pedido del usuario 2026-10-13): cortes y despachos, cómo empacamos,
// ciudades que más compran, creativos, rastreo de guías y garantías.

// ---- Cortes del día (tabla "PROVEDIX - CORTES Y DESPACHOS", la vigente) -------

const CARRIERS = ["Servientrega", "Gintracom", "LaarCourier", "Urbano", "Veloces"];

// Cuenta regresiva (pedido de Daniel 2026-10-13): HH:MM:SS, en vivo.
export function clock(total: number): string {
  const t = Math.max(0, Math.floor(total));
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${pad(Math.floor(t / 3600))}:${pad(Math.floor((t % 3600) / 60))}:${pad(t % 60)}`;
}

function LiveCut() {
  const [state, setState] = useState<CutState | null>(null);
  useEffect(() => {
    const tick = () => setState(cutState());
    tick();
    const t = setInterval(tick, 1000);
    return () => clearInterval(t);
  }, []);
  return (
    <div data-tour="cortes" className="rounded-[24px] bg-[var(--pvx-night-2)] p-5 sm:p-6">
      <div className="flex items-center gap-2 text-[13px] font-bold text-[var(--pvx-orange)]">
        <span className="relative flex h-2.5 w-2.5">
          <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-[var(--pvx-orange)] opacity-60 motion-reduce:hidden" />
          <span className="relative inline-flex h-2.5 w-2.5 rounded-full bg-[var(--pvx-orange)]" />
        </span>
        Ahora en Guayaquil
      </div>
      <p className="pvx-heading mt-3 min-h-[1em] text-[24px] text-white sm:text-[28px]" aria-live="polite">
        {state?.title ?? " "}
      </p>
      {state?.countdown != null && (
        <div className="mt-3">
          {state.countdownLabel && <span className="block text-[13px] font-semibold text-white/60">{state.countdownLabel}</span>}
          <time aria-label={`Faltan ${clock(state.countdown)}`} className="pvx-display pvx-num mt-1 flex items-baseline gap-1 text-[52px] text-[var(--pvx-orange)] sm:text-[64px]">
            {clock(state.countdown)
              .split(":")
              .map((part, i) => (
                <span key={i} className="flex items-baseline gap-1">
                  {i > 0 && <span className="text-white/25">:</span>}
                  <span className="flex flex-col items-center">
                    {part}
                    <span className="mt-1 text-[12px] font-semibold not-italic normal-case tracking-normal text-white/60">{["horas", "min", "seg"][i]}</span>
                  </span>
                </span>
              ))}
          </time>
        </div>
      )}
      <p className="mt-2 min-h-[3em] text-[15px] leading-relaxed text-white/75">{state?.detail ?? ""}</p>
      <ol className="mt-5 flex flex-col gap-2">
        {CUTS.map((c, i) => (
          <li
            key={c.label}
            className={`grid grid-cols-[1fr_auto] items-center gap-3 rounded-2xl px-4 py-3 transition-colors duration-300 ${state?.active === i ? "bg-[var(--pvx-orange)] text-white" : "bg-white/[.06] text-white"} ${state?.saturday && i > 0 ? "opacity-40" : ""}`}
          >
            <span>
              <span className="block text-[15px] font-bold">{c.label}</span>
              <span className={`block text-[13px] ${state?.active === i ? "text-white" : "text-white/65"}`}>Guías {c.printText}</span>
            </span>
            <span className="text-right">
              <span className={`block text-[12px] ${state?.active === i ? "text-white" : "text-white/65"}`}>Despacho</span>
              <span className="pvx-num block text-[15px] font-bold">{c.dispatchText}</span>
            </span>
          </li>
        ))}
      </ol>
      <p className="mt-4 text-[13px] leading-relaxed text-white/60">
        De lunes a viernes, con {CARRIERS.join(", ")}; si hay mucho volumen sumamos un corte más. Sábados: un solo corte (guías 8:30 – 9:00) con {SATURDAY_CARRIERS}. Los pedidos confirmados después del último corte salen el siguiente día hábil.
      </p>
    </div>
  );
}

const PACKING = [
  { src: "/pvx/work/impresion-guias.webp", title: "Guías impresas en cada corte", alt: "Impresora sacando guías de envío" },
  { src: "/pvx/work/empaque-1-producto.webp", title: "Revisamos el producto", alt: "Producto en su caja antes de empacar" },
  { src: "/pvx/work/empaque-2-burbuja.webp", title: "Lo protegemos con burbuja", alt: "Producto envuelto en plástico burbuja" },
  { src: "/pvx/work/empaque-3-film.webp", title: "Sellado con plástico film y su guía", alt: "Paquete sellado con plástico film negro y la guía pegada" },
];

export function PvxOperation() {
  return (
    <section id="cortes" className="scroll-mt-4 bg-[var(--pvx-night)] py-24 text-white sm:py-36" aria-labelledby="pvx-cuts">
      <div className="mx-auto max-w-[1240px] px-4 sm:px-8">
        <div className="grid gap-12 lg:grid-cols-[minmax(0,6fr)_minmax(0,5fr)] lg:gap-16">
          <div data-r>
            <h2 id="pvx-cuts" className="pvx-display text-[38px] sm:text-[64px]">
              Apenas entra, <span className="text-[var(--pvx-orange)]">sale</span>
            </h2>
            <p className="mt-6 max-w-[520px] text-[17px] leading-relaxed text-white/80 sm:text-[19px]">
              Hacemos más de 3 cortes al día para que cada pedido salga apenas ingresa. Del corte a la transportadora, en menos de 3 horas.
            </p>
            <dl className="mt-10 grid max-w-[520px] grid-cols-2 gap-6">
              <div>
                <dt className="sr-only">Cortes por día</dt>
                <dd>
                  <span className="pvx-display block text-[56px] text-[var(--pvx-orange)] sm:text-[72px]">+3</span>
                  <span className="mt-1 block text-[15px] text-white/75">cortes diarios</span>
                </dd>
              </div>
              <div>
                <dt className="sr-only">Tiempo de despacho</dt>
                <dd>
                  <span className="pvx-display block text-[56px] text-[var(--pvx-orange)] sm:text-[72px]">&lt;3 h</span>
                  <span className="mt-1 block text-[15px] text-white/75">del corte al despacho</span>
                </dd>
              </div>
            </dl>
          </div>
          <div data-r style={{ ["--d" as string]: 1 }}>
            <LiveCut />
          </div>
        </div>

        <h3 data-r className="pvx-heading mt-24 text-[28px] sm:mt-32 sm:text-[40px]">
          Así empacamos tus pedidos
        </h3>
        <ul className="pvx-scroll-x -mx-4 mt-8 flex snap-x snap-mandatory gap-3 overflow-x-auto px-4 sm:mx-0 sm:grid sm:grid-cols-4 sm:gap-4 sm:overflow-visible sm:px-0">
          {PACKING.map((p, i) => (
            <li key={p.src} data-r style={{ ["--d" as string]: i }} className="w-[68%] shrink-0 snap-start sm:w-auto">
              <div className="relative aspect-[3/4] overflow-hidden rounded-[22px] bg-[var(--pvx-night-2)]">
                <Image src={p.src} alt={p.alt} fill sizes="(max-width: 640px) 68vw, 25vw" className="object-cover" />
              </div>
              <p className="mt-3 text-[15px] font-semibold">{p.title}</p>
            </li>
          ))}
        </ul>
      </div>
    </section>
  );
}

// ---- Nuestro equipo (fotos del equipo, pedido del usuario 2026-10-16) ----------
// Solo "Guayaquil, Ecuador", sin dirección ni mapa. Las fotos y su rotación
// semanal están en src/lib/pvxTeamPhotos.ts.

// Una sola foto que cambia sola (pedido del usuario 2026-10-16: la galería
// de 6 ocupaba mucho). Con "reducir movimiento" no avanza sola; se cambia con
// los puntos. Se pausa con el mouse encima.
const TEAM_SLIDE_MS = 4500;

export function PvxTeam({ photos }: { photos: TeamPhoto[] }) {
  const [active, setActive] = useState(0);
  const [paused, setPaused] = useState(false);
  useEffect(() => {
    if (paused || photos.length < 2) return;
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
    const t = setInterval(() => setActive((i) => (i + 1) % photos.length), TEAM_SLIDE_MS);
    return () => clearInterval(t);
  }, [paused, photos.length]);
  if (!photos.length) return null;
  const current = photos[active % photos.length];
  return (
    <section className="bg-[var(--pvx-paper)] py-16 sm:py-24" aria-labelledby="pvx-team">
      <div className="mx-auto grid max-w-[1240px] items-center gap-8 px-4 sm:px-8 md:grid-cols-[minmax(0,1fr)_minmax(0,380px)] lg:gap-16">
        <div data-r>
          <h2 id="pvx-team" className="pvx-display text-[38px] sm:text-[56px]">
            Un equipo que <span className="text-[var(--pvx-orange)]">sí existe</span>
          </h2>
          <p className="mt-5 max-w-[520px] text-[17px] leading-relaxed text-[var(--pvx-ink-2)] sm:text-[19px]">
            Recibimos, ordenamos, revisamos y despachamos tus pedidos desde nuestra bodega en Guayaquil, Ecuador.
          </p>
          <p className="mt-6 text-[15px] font-semibold" aria-live="polite">
            {current.title}
          </p>
        </div>
        <div data-r style={{ ["--d" as string]: 1 }} onMouseEnter={() => setPaused(true)} onMouseLeave={() => setPaused(false)}>
          <div className="relative mx-auto aspect-[4/5] w-full max-w-[260px] overflow-hidden rounded-[24px] sm:max-w-[380px] bg-[var(--pvx-paper-2)]">
            {photos.map((p, i) => (
              <Image
                key={p.src}
                src={p.src}
                alt={i === active ? p.alt : ""}
                aria-hidden={i !== active}
                fill
                sizes="(max-width: 640px) 260px, 380px"
                className={`object-cover transition-opacity duration-700 ease-out motion-reduce:transition-none ${i === active ? "opacity-100" : "opacity-0"}`}
              />
            ))}
          </div>
          {photos.length > 1 && (
            <div className="mt-3 flex justify-center gap-1">
              {photos.map((p, i) => (
                <button
                  key={p.src}
                  type="button"
                  onClick={() => setActive(i)}
                  aria-label={`Ver foto ${i + 1} de ${photos.length}`}
                  aria-current={i === active}
                  className="grid h-8 w-8 place-items-center cursor-pointer"
                >
                  <span className={`block h-2 rounded-full transition-all duration-300 ${i === active ? "w-5 bg-[var(--pvx-orange)]" : "w-2 bg-[var(--pvx-paper-3)]"}`} />
                </button>
              ))}
            </div>
          )}
        </div>
      </div>
    </section>
  );
}

// ---- Ciudades que más compran --------------------------------------------------

export function titleCase(s: string): string {
  return s.toLowerCase().replace(/(^|[\s-])(\p{L})/gu, (_, a: string, b: string) => a + b.toUpperCase());
}

export function PvxCities({ stats }: { stats: PublicStats }) {
  const rows = stats.topCities;
  if (rows.length < 3) return null;
  const max = Math.max(...rows.map((r) => r.share), 1);
  return (
    <section className="bg-[var(--pvx-paper-2)] py-24 sm:py-32" aria-labelledby="pvx-cities">
      <div className="mx-auto grid max-w-[1240px] gap-12 px-4 sm:px-8 lg:grid-cols-[minmax(0,5fr)_minmax(0,7fr)] lg:gap-20">
        <div data-r>
          <h2 id="pvx-cities" className="pvx-display text-[38px] sm:text-[clamp(40px,4.4vw,60px)]">
            Dónde se <span className="text-[var(--pvx-orange)]">vende más</span>
          </h2>
          <p className="mt-6 max-w-[440px] text-[17px] leading-relaxed text-[var(--pvx-ink-2)]">
            Así se reparten los pedidos de los últimos 30 días entre las ciudades de Ecuador
            {stats.cities ? `. Llegamos a ${stats.cities.replace("+", "más de ")} destinos.` : "."} Úsalo para segmentar tus anuncios.
          </p>
        </div>
        <ol className="flex flex-col gap-3">
          {rows.map((r, i) => (
            <li key={r.city} data-r style={{ ["--d" as string]: i }} className="grid grid-cols-[minmax(0,150px)_1fr_auto] items-center gap-4 sm:grid-cols-[200px_1fr_auto]">
              <span className={`truncate text-[16px] sm:text-[18px] ${i === 0 ? "font-extrabold" : "font-semibold"}`}>{titleCase(r.city)}</span>
              <span className="h-3 overflow-hidden rounded-full bg-white">
                <span className={`block h-full rounded-full ${i < 3 ? "bg-[var(--pvx-orange)]" : "bg-[var(--pvx-ink)]"}`} style={{ width: `${(r.share / max) * 100}%` }} />
              </span>
              <span className="pvx-num w-14 text-right text-[16px] font-bold">{r.share.toLocaleString("es-EC", { maximumFractionDigits: 1 })}%</span>
            </li>
          ))}
        </ol>
      </div>
    </section>
  );
}

// ---- Qué transportadora entrega mejor (pedido del usuario 2026-10-17) ----------
// Mismos datos que usa Michelle IA (provedixCarriers.ts): % de pedidos
// entregados de todos nuestros envíos, solo de las transportadoras con buena
// parte del volumen. Los días aparecen solos cuando hay entregas medidas.

// Ciudades en tarjetas que pasan solas (pedido del usuario 2026-10-17: la lista
// de 25 se veía muy apilada): 3 a la vez en computadora, 1 en el celular.
const CARRIER_SLIDE_MS = 5000;
const WIDE_QUERY = "(min-width: 640px)";

function subscribeWide(cb: () => void) {
  const m = window.matchMedia(WIDE_QUERY);
  m.addEventListener("change", cb);
  return () => m.removeEventListener("change", cb);
}

function daysLabel(d: number | null): string | null {
  if (d == null) return null;
  return d <= 0 ? "llega el mismo día" : d === 1 ? "suele llegar en 1 día" : `suele llegar en ${d} días`;
}

const plain = (t: string) => t.toLowerCase().normalize("NFD").replace(/\p{Diacritic}/gu, "");

function CityCard({ data }: { data: CityCarriers }) {
  const [best, second] = data.carriers;
  return (
    <li className="pvx-city-card flex flex-col rounded-[22px] bg-[var(--pvx-paper-2)] p-6">
      <p className="text-[20px] font-extrabold">{titleCase(data.city)}</p>
      <p className="mt-1 text-[13px] font-semibold text-[var(--pvx-ink-3)]">{data.similar ? "Las dos entregan parecido" : "La que mejor entrega"}</p>
      <div className="mt-5 flex items-baseline justify-between gap-3">
        <span className="text-[17px] font-bold">{best.carrier}</span>
        <span className="pvx-display text-[40px] leading-none text-[var(--pvx-orange)]">{best.pct}%</span>
      </div>
      {daysLabel(best.days) && <p className="mt-1 text-[13px] text-[var(--pvx-ink-2)]">{daysLabel(best.days)}</p>}
      {second && (
        <div className="mt-auto pt-5">
          <div className={`flex items-baseline justify-between gap-3 border-t border-[var(--pvx-paper-3)] pt-4 ${data.similar ? "" : "text-[var(--pvx-ink-3)]"}`}>
            <span className={data.similar ? "text-[17px] font-bold" : "text-[15px]"}>{second.carrier}</span>
            <span className={data.similar ? "pvx-display text-[40px] leading-none text-[var(--pvx-orange)]" : "text-[17px] font-bold"}>{second.pct}%</span>
          </div>
          {daysLabel(second.days) && <p className="mt-1 text-[13px] text-[var(--pvx-ink-2)]">{daysLabel(second.days)}</p>}
        </div>
      )}
    </li>
  );
}

export function PvxCarriers({ data }: { data: CarrierStats | null }) {
  const [query, setQuery] = useState("");
  const [page, setPage] = useState(0);
  const [paused, setPaused] = useState(false);
  const wide = useSyncExternalStore(subscribeWide, () => window.matchMedia(WIDE_QUERY).matches, () => true);
  const perPage = wide ? 3 : 1;
  const cities = data?.cities ?? [];
  const pages = Math.max(1, Math.ceil(cities.length / perPage));
  const q = plain(query.trim());
  useEffect(() => {
    if (paused || q || pages < 2) return;
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
    const t = setInterval(() => setPage((p) => (p + 1) % pages), CARRIER_SLIDE_MS);
    return () => clearInterval(t);
  }, [paused, q, pages]);
  if (!data || !data.general.length || cities.length < 3) return null;
  const current = page % pages;
  const shown = q ? cities.filter((c) => plain(c.city).includes(q)).slice(0, 3) : cities.slice(current * perPage, current * perPage + perPage);
  const go = (d: number) => setPage((current + d + pages) % pages);
  return (
    <section id="transportadoras" className="scroll-mt-4 bg-[var(--pvx-paper)] py-24 sm:py-32" aria-labelledby="pvx-carriers">
      <div className="mx-auto max-w-[1240px] px-4 sm:px-8">
        <div className="grid gap-10 lg:grid-cols-[minmax(0,7fr)_minmax(0,5fr)] lg:items-end lg:gap-16">
          <div data-r>
            <h2 id="pvx-carriers" className="pvx-display text-[36px] sm:text-[clamp(40px,4.4vw,60px)]">
              Qué transportadora <span className="text-[var(--pvx-orange)]">entrega mejor</span>
            </h2>
            <p className="mt-6 max-w-[560px] text-[17px] leading-relaxed text-[var(--pvx-ink-2)]">
              Porcentaje de pedidos que llegaron a su cliente (y no se devolvieron) en nuestros envíos de los últimos 60 días. Elige la transportadora según la ciudad de tu cliente al crear el pedido en Dropi.
            </p>
          </div>
          <dl data-r style={{ ["--d" as string]: 1 }} className="grid grid-cols-2 gap-6">
            {data.general.map((g) => (
              <div key={g.carrier}>
                <dt className="text-[15px] font-semibold text-[var(--pvx-ink-2)]">{g.carrier}</dt>
                <dd>
                  <span className="pvx-display block text-[48px] text-[var(--pvx-orange)] sm:text-[60px]">{g.pct}%</span>
                  <span className="block text-[14px] text-[var(--pvx-ink-3)]">{daysLabel(g.days) ?? "entregados en todo el país"}</span>
                </dd>
              </div>
            ))}
          </dl>
        </div>

        <div
          data-r
          style={{ ["--d" as string]: 2 }}
          className="mt-14"
          onMouseEnter={() => setPaused(true)}
          onMouseLeave={() => setPaused(false)}
          onFocus={() => setPaused(true)}
          onBlur={() => setPaused(false)}
        >
          <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
            <label className="block w-full sm:max-w-[360px]">
              <span className="sr-only">Buscar ciudad</span>
              <input
                type="search"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder="Busca la ciudad de tu cliente"
                className="w-full rounded-full border border-[var(--pvx-paper-3)] bg-[var(--pvx-paper-2)] px-5 py-3.5 text-[16px] outline-none focus:border-[var(--pvx-orange)]"
              />
            </label>
            {!q && pages > 1 && (
              <div className="flex items-center gap-3 self-end sm:self-auto">
                <span className="pvx-num text-[14px] text-[var(--pvx-ink-3)]" aria-live="polite">
                  {current + 1} de {pages}
                </span>
                <button
                  type="button"
                  onClick={() => go(-1)}
                  aria-label="Ciudades anteriores"
                  className="grid h-11 w-11 cursor-pointer place-items-center rounded-full border border-[var(--pvx-paper-3)] hover:border-[var(--pvx-ink)]"
                >
                  <IconArrow className="h-4 w-4 rotate-180" />
                </button>
                <button
                  type="button"
                  onClick={() => go(1)}
                  aria-label="Siguientes ciudades"
                  className="grid h-11 w-11 cursor-pointer place-items-center rounded-full bg-[var(--pvx-ink)] text-white hover:bg-[var(--pvx-orange)]"
                >
                  <IconArrow className="h-4 w-4" />
                </button>
              </div>
            )}
          </div>
          <ul key={q ? `q-${q}` : `p-${current}-${perPage}`} className="mt-6 grid gap-4 sm:grid-cols-3">
            {shown.map((c) => (
              <CityCard key={c.city} data={c} />
            ))}
            {!shown.length && (
              <li className="py-4 text-[15px] text-[var(--pvx-ink-3)] sm:col-span-3">No tenemos suficientes envíos a esa ciudad para comparar. Pregúntale a Michelle IA.</li>
            )}
          </ul>
          <p className="mt-6 text-[14px] leading-relaxed text-[var(--pvx-ink-3)]">
            Solo comparamos las transportadoras que llevan una buena parte de nuestros envíos: con pocos pedidos el porcentaje no es confiable.
          </p>
        </div>
      </div>
    </section>
  );
}

// ---- Recursos: creativos, rastreo y garantías ----------------------------------

// Una hoja por marca (manuales de trabajo, 2026-10-16: el manual ya no se
// usa, todo va en la página).
const CREATIVES = [
  { name: "Provedix", url: "https://docs.google.com/spreadsheets/d/1TrZRjyttpd8BaQoWtxz775hEB4Vu-iZMT8yCT2wtkJA/edit?gid=0#gid=0" },
  { name: "Importadora Damián", url: "https://docs.google.com/spreadsheets/d/1_B7-4XDGabH8UkL1dE5lo_oPFREmzDKAffgfJRnLRPw/edit?gid=0#gid=0" },
];
const TRACKING = [
  { name: "Servientrega", url: PVX_LINKS["rastreo-servientrega"].url },
  { name: "Gintracom", url: PVX_LINKS["rastreo-gintracom"].url },
  { name: "LaarCourier", url: PVX_LINKS["rastreo-laarcourier"].url },
  { name: "Urbano", url: PVX_LINKS["rastreo-urbano"].url },
  { name: "Veloces", url: PVX_LINKS["rastreo-veloces"].url },
];
// Línea de atención al cliente del manual (garantías), elegida por el usuario
// 2026-10-13 — sin el correo.

export function PvxResources() {
  return (
    <section id="recursos" className="scroll-mt-4 bg-[var(--pvx-paper-2)] py-24 sm:py-32" aria-labelledby="pvx-resources">
      <div className="mx-auto max-w-[1240px] px-4 sm:px-8">
        <h2 id="pvx-resources" data-r className="pvx-display max-w-[820px] text-[38px] sm:text-[60px]">
          Todo para <span className="text-[var(--pvx-orange)]">vender tranquilo</span>
        </h2>

        <div className="mt-14 grid gap-4 lg:grid-cols-[minmax(0,7fr)_minmax(0,5fr)]">
          <div data-r data-tour="recursos" className="flex flex-col justify-between gap-8 rounded-[28px] bg-[var(--pvx-orange)] p-7 text-white sm:p-10">
            <div>
              <span className="grid h-14 w-14 place-items-center rounded-2xl bg-[var(--pvx-ink)] text-[var(--pvx-orange)]">
                <IconImage className="w-7 h-7" />
              </span>
              <h3 className="pvx-heading mt-8 text-[30px] sm:text-[40px]">Creativos ganadores, gratis</h3>
              <p className="mt-3 max-w-[480px] text-[16px] leading-relaxed text-white sm:text-[17px]">
                Fotos y videos exclusivos de nuestros productos, listos para publicar y editar libremente. Abre la hoja de tu marca y busca el producto por nombre o ID, o
                pídeselo a Michelle IA y te abre directo su carpeta.
              </p>
            </div>
            <div className="flex flex-wrap gap-2">
              {CREATIVES.map((c) => (
                <a
                  key={c.url}
                  href={c.url}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="pvx-press inline-flex items-center gap-2 rounded-full bg-white px-5 py-3.5 text-[15px] font-bold text-[var(--pvx-ink)] hover:bg-[var(--pvx-ink)] hover:text-white"
                >
                  Creativos {c.name} <IconExternal className="w-4 h-4" />
                </a>
              ))}
            </div>
          </div>

          <div data-r style={{ ["--d" as string]: 1 }} className="rounded-[28px] bg-white p-7 sm:p-10">
            <span className="grid h-14 w-14 place-items-center rounded-2xl bg-[var(--pvx-ink)] text-[var(--pvx-orange)]">
              <IconTruck className="w-7 h-7" />
            </span>
            <h3 className="pvx-heading mt-8 text-[28px] sm:text-[34px]">Rastrea tu guía</h3>
            <p className="mt-3 text-[16px] leading-relaxed text-[var(--pvx-ink-2)]">Entra a la página oficial de la transportadora y escribe el número de guía.</p>
            <ul className="mt-6 flex flex-wrap gap-2">
              {TRACKING.map((t) => (
                <li key={t.name}>
                  <a
                    href={t.url}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="pvx-press inline-flex items-center gap-1.5 rounded-full bg-[var(--pvx-paper-2)] px-4 py-2.5 text-[14px] font-bold hover:bg-[var(--pvx-ink)] hover:text-white"
                  >
                    {t.name} <IconExternal className="w-3.5 h-3.5" />
                  </a>
                </li>
              ))}
            </ul>
          </div>
        </div>

        <div data-r className="mt-4 grid gap-8 rounded-[28px] bg-[var(--pvx-night)] p-7 text-white sm:p-10 lg:grid-cols-[minmax(0,5fr)_minmax(0,7fr)] lg:gap-16">
          <div>
            <span className="grid h-14 w-14 place-items-center rounded-2xl bg-[var(--pvx-orange)] text-white">
              <IconCheck className="w-7 h-7" />
            </span>
            <h3 className="pvx-heading mt-8 text-[28px] sm:text-[36px]">Garantías claras</h3>
            <p className="mt-3 text-[16px] leading-relaxed text-white/75">Si la orden llegó incompleta, con un error o con un producto diferente al que pediste, lo resolvemos.</p>
            {/* Garantías por el chat de Michelle IA (2026-10-15): el 099 514 7410 se quitó. */}
            <a
              href="#michelle"
              className="pvx-press mt-7 inline-flex items-center gap-2 rounded-full bg-[var(--pvx-orange)] px-6 py-3.5 text-[15px] font-bold text-white hover:bg-[var(--pvx-orange-press)]"
            >
              Pedir garantía a Michelle IA <IconArrow className="w-5 h-5" />
            </a>
          </div>
          <ol className="flex flex-col gap-3 self-center">
            {[
              { icon: <IconClock className="w-5 h-5" />, title: "Escríbele a Michelle IA dentro de 48 horas", text: "Contadas desde que el cliente recibe el producto. Ten a la mano tu número de guía." },
              { icon: <IconImage className="w-5 h-5" />, title: "Envía fotos o video", text: "Mejor si son del momento de la entrega o en la agencia de la transportadora." },
              { icon: <IconArrow className="w-5 h-5" />, title: "Regístrala en Dropi", text: "Cuando revisemos la evidencia y la aprobemos, la registras en Dropi y la gestionamos." },
            ].map((s) => (
              <li key={s.title} className="grid grid-cols-[auto_1fr] gap-4 rounded-2xl bg-white/[.06] p-4 sm:p-5">
                <span className="grid h-10 w-10 place-items-center rounded-xl bg-white/10 text-[var(--pvx-orange)]">{s.icon}</span>
                <span>
                  <span className="block text-[16px] font-bold">{s.title}</span>
                  <span className="mt-0.5 block text-[14.5px] leading-relaxed text-white/70">{s.text}</span>
                </span>
              </li>
            ))}
          </ol>
        </div>

        {/* Cancelar o retener una guía (del manual, 2026-10-16), con el proceso de hoy:
            por el chat de Michelle IA. Mismos horarios que michelleCancelTiming.ts. */}
        <div data-r className="mt-4 grid gap-8 rounded-[28px] bg-white p-7 sm:p-10 lg:grid-cols-[minmax(0,5fr)_minmax(0,7fr)] lg:gap-16">
          <div>
            <span className="grid h-14 w-14 place-items-center rounded-2xl bg-[var(--pvx-ink)] text-[var(--pvx-orange)]">
              <IconClock className="w-7 h-7" />
            </span>
            <h3 className="pvx-heading mt-8 text-[28px] sm:text-[36px]">Cancelar o retener una guía</h3>
            <p className="mt-3 text-[16px] leading-relaxed text-[var(--pvx-ink-2)]">
              De lunes a viernes hasta las <b className="text-[var(--pvx-ink)]">11:00</b> (Veloces hasta las <b className="text-[var(--pvx-ink)]">9:30</b>). Sábados, domingos y feriados no se cancelan guías.
            </p>
            <a
              href="#michelle"
              className="pvx-press mt-7 inline-flex items-center gap-2 rounded-full bg-[var(--pvx-orange)] px-6 py-3.5 text-[15px] font-bold text-white hover:bg-[var(--pvx-orange-press)]"
            >
              Cancelar con Michelle IA <IconArrow className="w-5 h-5" />
            </a>
          </div>
          <ol className="flex flex-col gap-3 self-center">
            {[
              { title: "Cancela primero el pedido en Dropi", text: "Usa el botón flotante de Dropi para pedir la anulación." },
              { title: "Pídele a Michelle IA que retenga la guía", text: "Ten a la mano el número de guía, el nombre de tu tienda y el nombre completo de tu cliente." },
              { title: "Te confirmamos con foto", text: "En el mismo chat te contamos si se retuvo, con una foto de la guía como respaldo." },
              { title: "¿Guía rechazada?", text: "Envía la captura por el botón flotante de Dropi en máximo 48 horas." },
            ].map((s, i) => (
              <li key={s.title} className="grid grid-cols-[auto_1fr] gap-4 rounded-2xl bg-[var(--pvx-paper-2)] p-4 sm:p-5">
                <span className="pvx-num grid h-10 w-10 place-items-center rounded-xl bg-[var(--pvx-orange)] text-[16px] font-extrabold text-white">{i + 1}</span>
                <span>
                  <span className="block text-[16px] font-bold">{s.title}</span>
                  <span className="mt-0.5 block text-[14.5px] leading-relaxed text-[var(--pvx-ink-2)]">{s.text}</span>
                </span>
              </li>
            ))}
          </ol>
        </div>

        {/* Beneficio del manual ("Buenas prácticas de venta"), pedido 2026-10-13. */}
        <div data-r className="mt-4 grid gap-8 rounded-[28px] bg-white p-7 sm:p-10 lg:grid-cols-[minmax(0,5fr)_minmax(0,7fr)] lg:gap-16">
          <div>
            <h3 className="pvx-heading text-[28px] sm:text-[36px]">
              Vende bien y <span className="text-[var(--pvx-orange)]">te premiamos</span>
            </h3>
            <p className="mt-3 text-[16px] leading-relaxed text-[var(--pvx-ink-2)]">
              Los dropshippers que atienden bien a sus clientes reciben beneficios. Revisa que haya stock antes de lanzar campañas, no prometas de más y mantén una
              comunicación clara con tus clientes.
            </p>
          </div>
          <ul className="grid gap-3 self-center sm:grid-cols-3">
            {[
              { icon: <IconTrendUp className="w-5 h-5" />, title: "Prioridad en reposiciones", text: "Cuando llega stock, primero para ti." },
              { icon: <IconSpark className="w-5 h-5" />, title: "Productos nuevos antes", text: "Acceso anticipado a lo que recién llega." },
              { icon: <IconBox className="w-5 h-5" />, title: "Stock reservado", text: "Stock apartado para que vendas tranquilo." },
            ].map((b) => (
              <li key={b.title} className="rounded-2xl bg-[var(--pvx-paper-2)] p-5">
                <span className="grid h-10 w-10 place-items-center rounded-xl bg-[var(--pvx-orange)] text-white">{b.icon}</span>
                <span className="mt-4 block text-[16px] font-bold">{b.title}</span>
                <span className="mt-1 block text-[14.5px] leading-relaxed text-[var(--pvx-ink-2)]">{b.text}</span>
              </li>
            ))}
          </ul>
        </div>
      </div>
    </section>
  );
}

// ---- Preguntas frecuentes + promesa de respuesta (pedido del usuario 2026-10-16) ----

export function PvxFaq() {
  return (
    <section id="preguntas" className="scroll-mt-4 bg-[var(--pvx-paper)] py-24 sm:py-32" aria-labelledby="pvx-faq">
      <div className="mx-auto grid max-w-[1240px] gap-12 px-4 sm:px-8 lg:grid-cols-[minmax(0,5fr)_minmax(0,7fr)] lg:gap-20">
        <div data-r>
          <h2 id="pvx-faq" className="pvx-display text-[38px] sm:text-[clamp(40px,4.4vw,60px)]">
            Preguntas <span className="text-[var(--pvx-orange)]">frecuentes</span>
          </h2>
          <p className="mt-6 max-w-[440px] text-[17px] leading-relaxed text-[var(--pvx-ink-2)]">Lo que más nos preguntan los dropshippers antes de empezar.</p>
          {/* Promesa de respuesta: la asesora humana en menos de 3 horas, en horario de trabajo. */}
          <div className="mt-8 max-w-[440px] rounded-[24px] bg-[var(--pvx-night)] p-6 text-white">
            <span className="grid h-12 w-12 place-items-center rounded-2xl bg-[var(--pvx-orange)] text-white">
              <IconClock className="w-6 h-6" />
            </span>
            <p className="pvx-heading mt-6 text-[24px]">Te respondemos en {ADVISOR_RESPONSE_PROMISE}</p>
            <p className="mt-2 text-[15px] leading-relaxed text-white/75">
              Michelle IA te responde al instante. Si tu caso necesita a una persona, el equipo te responde en el mismo chat en {ADVISOR_RESPONSE_PROMISE}, de {WORK_HOURS_TEXT}.
            </p>
            <a
              href="#michelle"
              className="pvx-press mt-6 inline-flex items-center gap-2 rounded-full bg-[var(--pvx-orange)] px-5 py-3 text-[15px] font-bold text-white hover:bg-[var(--pvx-orange-press)]"
            >
              Preguntar a Michelle IA <IconArrow className="w-4 h-4" />
            </a>
          </div>
        </div>
        <ul className="flex flex-col gap-3">
          {PVX_FAQ.map((f, i) => (
            <li key={f.q} data-r style={{ ["--d" as string]: Math.min(i, 3) }}>
              <details className="group rounded-[22px] bg-[var(--pvx-paper-2)] open:bg-white open:shadow-[0_0_0_2px_var(--pvx-paper-3)]">
                <summary className="flex cursor-pointer list-none items-center justify-between gap-4 p-5 text-[17px] font-bold sm:p-6 [&::-webkit-details-marker]:hidden">
                  {f.q}
                  <span aria-hidden className="grid h-8 w-8 shrink-0 place-items-center rounded-full bg-white text-[20px] leading-none text-[var(--pvx-orange-text)] transition-transform group-open:rotate-45 group-open:bg-[var(--pvx-paper-2)]">
                    +
                  </span>
                </summary>
                <p className="-mt-1 px-5 pb-5 text-[16px] leading-relaxed text-[var(--pvx-ink-2)] sm:px-6 sm:pb-6">{f.a}</p>
              </details>
            </li>
          ))}
        </ul>
      </div>
    </section>
  );
}

// ---- Opiniones reales (casos de éxito, pedido del usuario 2026-10-16) ----------
// Solo aparece cuando hay datos reales suficientes (getPublicTestimonials).

export function PvxTestimonials({ data }: { data: PublicTestimonials | null }) {
  if (!data) return null;
  const avg = data.avg.toLocaleString("es-EC", { minimumFractionDigits: 1, maximumFractionDigits: 1 });
  return (
    <section className="bg-[var(--pvx-paper-2)] py-24 sm:py-32" aria-labelledby="pvx-testimonials">
      <div className="mx-auto max-w-[1240px] px-4 sm:px-8">
        <div data-r className="flex flex-col gap-6 sm:flex-row sm:items-end sm:justify-between">
          <h2 id="pvx-testimonials" className="pvx-display max-w-[720px] text-[38px] sm:text-[60px]">
            Lo que dicen los <span className="text-[var(--pvx-orange)]">dropshippers</span>
          </h2>
          <p className="shrink-0">
            <span className="pvx-display pvx-num text-[48px] text-[var(--pvx-orange)]">{avg}</span>
            <span className="ml-2 text-[15px] font-semibold text-[var(--pvx-ink-2)]">
              de 5 · {data.total} calificaciones
            </span>
          </p>
        </div>
        <ul className="mt-12 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {data.items.map((t, i) => (
            <li key={t.id} data-r style={{ ["--d" as string]: i % 3 }} className="flex flex-col rounded-[24px] bg-white p-6 sm:p-7">
              <span className="text-[18px] tracking-[2px] text-[var(--pvx-orange)]" aria-label={`${t.stars} de 5 estrellas`}>
                {"★".repeat(t.stars)}
                <span className="text-[var(--pvx-paper-3)]">{"★".repeat(5 - t.stars)}</span>
              </span>
              <p className="mt-4 flex-1 text-[16px] leading-relaxed">“{t.comment}”</p>
              <p className="mt-5 text-[14px] text-[var(--pvx-ink-2)]">
                <span className="font-bold text-[var(--pvx-ink)]">{t.firstName}</span> · {t.tool}
              </p>
            </li>
          ))}
        </ul>
      </div>
    </section>
  );
}
