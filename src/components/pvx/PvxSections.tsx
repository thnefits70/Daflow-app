"use client";

import Image from "next/image";
import { useEffect, useState } from "react";
import type { PublicStats } from "@/lib/provedixPublic";
import { isWorkingDay, nextWorkingDay } from "@/lib/ecuadorHolidays";
import { ADVISOR_RESPONSE_PROMISE, PVX_FAQ, WORK_HOURS_TEXT } from "@/lib/pvxFaq";
import type { PublicTestimonials } from "@/lib/provedixRatings";
import type { TeamPhoto } from "@/lib/pvxTeamPhotos";
import { IconArrow, IconBox, IconCheck, IconClock, IconExternal, IconImage, IconSpark, IconTrendUp, IconTruck } from "@/components/pvx/PvxIcons";

// Secciones sacadas del "Manual de Trabajo Provedix – Actualizado 2026"
// (pedido del usuario 2026-10-13): cortes y despachos, cómo empacamos,
// ciudades que más compran, creativos, rastreo de guías y garantías.

// ---- Cortes del día (tabla "PROVEDIX - CORTES Y DESPACHOS", la vigente) -------

const CUTS = [
  { label: "Corte de la mañana", print: [8 * 60 + 30, 9 * 60], printText: "8:30 – 9:00", dispatchText: "9:00 – 11:00" },
  { label: "Corte del mediodía", print: [11 * 60, 11 * 60 + 30], printText: "11:00 – 11:30", dispatchText: "11:30 – 14:00" },
  { label: "Corte de la tarde", print: [14 * 60, 14 * 60 + 30], printText: "14:00 – 14:30", dispatchText: "14:30 – 16:00" },
] as const;
// Sábado (confirmado por el usuario 2026-10-13): se trabaja de 8:30 a 12:30
// y hay UN solo corte, el de la mañana, solo con Veloces, Servientrega y
// Gintracom.
const SATURDAY_CARRIERS = "Veloces, Servientrega y Gintracom";

const CARRIERS = ["Servientrega", "Gintracom", "LaarCourier", "Urbano", "Veloces"];

const WEEKDAY = ["domingo", "lunes", "martes", "miércoles", "jueves", "viernes", "sábado"];

function ecuadorNow(): { day: string; minutes: number; seconds: number; dow: number } {
  // Ecuador: UTC−5 todo el año, sin horario de verano.
  const d = new Date(Date.now() - 5 * 3_600_000);
  const seconds = d.getUTCHours() * 3600 + d.getUTCMinutes() * 60 + d.getUTCSeconds();
  return { day: d.toISOString().slice(0, 10), minutes: Math.floor(seconds / 60), seconds, dow: d.getUTCDay() };
}

// Cuenta regresiva (pedido de Daniel 2026-10-13): HH:MM:SS, en vivo.
export function clock(total: number): string {
  const t = Math.max(0, Math.floor(total));
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${pad(Math.floor(t / 3600))}:${pad(Math.floor((t % 3600) / 60))}:${pad(t % 60)}`;
}

function daysBetween(a: string, b: string): number {
  return Math.round((Date.parse(`${b}T12:00:00Z`) - Date.parse(`${a}T12:00:00Z`)) / 86_400_000);
}

function cutsFor(dow: number) {
  return dow === 6 ? CUTS.slice(0, 1) : CUTS;
}

// countdown: segundos que faltan; countdownLabel: qué se está contando.
type CutState = { active: number | null; title: string; detail: string; saturday: boolean; countdown: number | null; countdownLabel: string };

export function cutState(): CutState {
  const { day, minutes, seconds, dow } = ecuadorNow();
  const saturday = dow === 6;
  // Segundos hasta el primer corte (8:30) del siguiente día de trabajo.
  const toNextMorning = () => daysBetween(day, nextWorkingDay(day)) * 86_400 + CUTS[0].print[0] * 60 - seconds;
  // Próximo día de trabajo; si es sábado, se avisa que ese día hay un solo corte.
  const nextDay = () => {
    const n = nextWorkingDay(day);
    const ndow = new Date(`${n}T12:00:00Z`).getUTCDay();
    const when = ndow === (dow + 1) % 7 ? "de mañana" : `del ${WEEKDAY[ndow]}`;
    return ndow === 6 ? `${when}, a las 8:30 (el sábado hay un solo corte, con ${SATURDAY_CARRIERS})` : `${when}, a las 8:30`;
  };
  if (!isWorkingDay(day)) {
    return { active: null, saturday, title: "Hoy no despachamos", detail: `Los pedidos que confirmes hoy salen en el primer corte ${nextDay()}.`, countdown: toNextMorning(), countdownLabel: "Próximo corte en" };
  }
  const satNote = saturday ? ` Hoy sábado hay un solo corte, con ${SATURDAY_CARRIERS}.` : "";
  const cuts = cutsFor(dow);
  for (let i = 0; i < cuts.length; i++) {
    const [from, to] = cuts[i].print;
    if (minutes < from)
      return { active: i, saturday, title: "Próximo corte en", detail: `${cuts[i].label}: imprimimos guías a las ${cuts[i].printText.split(" – ")[0]} y despachamos de ${cuts[i].dispatchText}.${satNote}`, countdown: from * 60 - seconds, countdownLabel: "" };
    if (minutes < to)
      return { active: i, saturday, title: "Imprimiendo guías ahora", detail: `${cuts[i].label}: lo que entra ahora sale de ${cuts[i].dispatchText}.${satNote}`, countdown: to * 60 - seconds, countdownLabel: "Este corte cierra en" };
  }
  return { active: null, saturday, title: saturday ? "El corte del sábado ya pasó" : "Los cortes de hoy ya terminaron", detail: `Lo que confirmes ahora sale en el primer corte ${nextDay()}.`, countdown: toNextMorning(), countdownLabel: "Próximo corte en" };
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
  { src: "/pvx/work/empaque-3-film.webp", title: "Film y guía, listo para salir", alt: "Paquete cerrado con film negro y la guía pegada" },
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

export function PvxTeam({ photos }: { photos: TeamPhoto[] }) {
  if (!photos.length) return null;
  return (
    <section className="bg-[var(--pvx-paper)] py-24 sm:py-32" aria-labelledby="pvx-team">
      <div className="mx-auto max-w-[1240px] px-4 sm:px-8">
        <div data-r className="max-w-[720px]">
          <h2 id="pvx-team" className="pvx-display text-[38px] sm:text-[60px]">
            Un equipo que <span className="text-[var(--pvx-orange)]">sí existe</span>
          </h2>
          <p className="mt-6 text-[17px] leading-relaxed text-[var(--pvx-ink-2)] sm:text-[19px]">
            Recibimos, ordenamos, revisamos y despachamos tus pedidos desde nuestra bodega en Guayaquil, Ecuador.
          </p>
        </div>
        <ul className="pvx-scroll-x -mx-4 mt-10 flex snap-x snap-mandatory gap-3 overflow-x-auto px-4 sm:mx-0 sm:grid sm:grid-cols-3 sm:gap-4 sm:overflow-visible sm:px-0">
          {photos.map((p, i) => (
            <li key={p.src} data-r style={{ ["--d" as string]: i % 3 }} className="w-[68%] shrink-0 snap-start sm:w-auto">
              <div className="relative aspect-[3/4] overflow-hidden rounded-[22px] bg-[var(--pvx-paper-2)]">
                <Image src={p.src} alt={p.alt} fill sizes="(max-width: 640px) 68vw, 33vw" className="object-cover" />
              </div>
              <p className="mt-3 text-[15px] font-semibold">{p.title}</p>
            </li>
          ))}
        </ul>
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

// ---- Recursos: creativos, rastreo y garantías ----------------------------------

const CREATIVES_URL = "https://docs.google.com/spreadsheets/d/1TrZRjyttpd8BaQoWtxz775hEB4Vu-iZMT8yCT2wtkJA/edit?gid=0#gid=0";
const TRACKING = [
  { name: "Servientrega", url: "https://www.servientrega.com.ec/" },
  { name: "Gintracom", url: "https://ec.gintracom.site/web/site/tracking" },
  { name: "LaarCourier", url: "https://fenixoper.laarcourier.com/Tracking/Guiacompleta.aspx" },
  { name: "Urbano", url: "https://www.urbano.com.ec/" },
  { name: "Veloces", url: "https://tracking.veloces.app/" },
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
                Fotos y videos exclusivos de nuestros productos, listos para publicar y editar libremente. Busca por nombre o ID con Ctrl + F y abre el enlace de la columna
                &ldquo;Link de creativos&rdquo;.
              </p>
            </div>
            <a
              href={CREATIVES_URL}
              target="_blank"
              rel="noopener noreferrer"
              className="pvx-press inline-flex items-center gap-2 self-start rounded-full bg-white px-6 py-3.5 text-[15px] font-bold text-[var(--pvx-ink)] hover:bg-[var(--pvx-ink)] hover:text-white"
            >
              Abrir creativos <IconExternal className="w-4 h-4" />
            </a>
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
              Michelle IA te responde al instante. Si tu caso necesita a una persona, la asesora del equipo te escribe por WhatsApp en {ADVISOR_RESPONSE_PROMISE}, de {WORK_HOURS_TEXT}.
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
