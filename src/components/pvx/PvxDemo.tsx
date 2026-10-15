"use client";

import { useEffect, useRef, useState } from "react";
import type { PublicCard } from "@/lib/provedixPublic";
import { PvxPhoto } from "@/components/pvx/PvxPhoto";
import {
  IconArrow,
  IconBox,
  IconCheck,
  IconCopy,
  IconExternal,
  IconLock,
  IconSearch,
  IconTruck,
} from "@/components/pvx/PvxIcons";

// "Video" de presentación de provedix.com (pedido del usuario 2026-10-14):
// una animación en vivo hecha con la misma página — no un archivo de video —
// que muestra en 4 escenas cómo se usa, con productos reales que van rotando
// (ver pickDemoCards). Sin sonido, con textos; se pausa con un botón, se puede
// saltar a cada escena y se detiene sola si no está en pantalla.

const SCENE_MS = 5000;
const SCENES = [
  "Busca un producto ganador",
  "Mira cuánto se vende",
  "Copia el ID y véndelo en Dropi",
  "Tú vendes, nosotros despachamos",
];

function Typed({ text, active }: { text: string; active: boolean }) {
  const [n, setN] = useState(0);
  useEffect(() => {
    // Cada escena se vuelve a montar (key), así que n empieza en 0.
    if (!active) return;
    let i = 0;
    const t = setInterval(
      () => {
        i += 1;
        setN(i);
        if (i >= text.length) clearInterval(t);
      },
      Math.max(35, Math.min(80, 1600 / text.length)),
    );
    return () => clearInterval(t);
  }, [active, text]);
  return (
    <>
      {text.slice(0, n)}
      <span className="pvx-caret ml-px inline-block h-[1.1em] w-[2px] translate-y-[2px] bg-[var(--pvx-orange)]" />
    </>
  );
}

function SceneSearch({ c, active }: { c: PublicCard; active: boolean }) {
  const q = c.name.split(" ").slice(0, 3).join(" ").toLowerCase();
  return (
    <div className="flex h-full flex-col justify-center gap-3 px-5">
      <div className="flex items-center gap-2 rounded-full bg-white px-4 py-3 text-[15px] text-[var(--pvx-ink)]">
        <IconSearch className="w-5 h-5 shrink-0 text-[var(--pvx-ink-3)]" />
        <span className="truncate">
          {active ? <Typed text={q} active={active} /> : q}
        </span>
      </div>
      {active && (
        <div
          className="pvx-demo-in flex items-center gap-3 rounded-2xl bg-white p-2.5 pr-4 text-[var(--pvx-ink)]"
          style={{ animationDelay: "1.9s" }}
        >
          <span className="relative h-14 w-14 shrink-0 overflow-hidden rounded-xl bg-[var(--pvx-paper-2)]">
            <PvxPhoto src={c.photo} alt="" sizes="56px" fit="contain" />
          </span>
          <span className="min-w-0">
            <span className="pvx-num block text-[12px] font-extrabold italic text-[var(--pvx-orange-text)]">
              {c.rank <= 10
                ? `#${c.rank} más vendido`
                : c.stock === "new"
                  ? "✨ Nuevo stock · pruébalo"
                  : "🚀 En subida · pruébalo"}
            </span>
            <span className="block truncate text-[14px] font-semibold">
              {c.name}
            </span>
            <span className="block text-[12.5px] text-[var(--pvx-ink-2)]">
              <b className="text-[var(--pvx-ink)]">{c.soldRange}</b> vendidos en
              30 días
            </span>
          </span>
        </div>
      )}
    </div>
  );
}

function SceneSales({ c, active }: { c: PublicCard; active: boolean }) {
  const curve = (c.curve ?? []).slice(-14);
  const max = Math.max(...curve, 1);
  return (
    <div className="flex h-full items-center gap-4 px-5">
      <div className="relative aspect-square w-[34%] max-w-[150px] shrink-0 overflow-hidden rounded-2xl bg-white">
        <PvxPhoto src={c.photo} alt="" sizes="150px" fit="contain" />
      </div>
      <div className="min-w-0 flex-1">
        <div className="line-clamp-2 text-[14px] font-semibold text-white/85">
          {c.name}
        </div>
        <div className="pvx-heading mt-1 text-[24px] text-white sm:text-[28px]">
          {c.soldRange}{" "}
          <span className="text-[13px] font-semibold not-italic text-white/70">
            vendidos
          </span>
        </div>
        <div className="mt-2 flex h-[64px] items-end gap-[3px]">
          {curve.map((v, i) => (
            <span
              key={i}
              className={`block flex-1 origin-bottom rounded-t-[3px] ${v > 0 ? "bg-[var(--pvx-orange)]" : "bg-white/15"} ${active ? "pvx-demo-bar" : ""}`}
              style={{
                height: v > 0 ? `${Math.max(12, (v / max) * 100)}%` : 3,
                animationDelay: `${0.3 + i * 0.06}s`,
              }}
            />
          ))}
        </div>
        <div className="mt-2 inline-flex items-center gap-1.5 rounded-full bg-white/10 px-2.5 py-1 text-[11.5px] font-semibold text-white/80">
          <IconLock className="w-3 h-3" /> Precio, ganancia y ciudades: gratis
          al registrarte
        </div>
      </div>
    </div>
  );
}

function SceneCopy({ c, active }: { c: PublicCard; active: boolean }) {
  const [copied, setCopied] = useState(false);
  useEffect(() => {
    if (!active) return;
    const t = setTimeout(() => setCopied(true), 1400);
    return () => clearTimeout(t);
  }, [active]);
  return (
    <div className="flex h-full flex-col items-center justify-center gap-4 px-5 text-center">
      <div
        className={`flex items-center gap-3 rounded-full bg-white px-5 py-3 text-[var(--pvx-ink)] transition-transform duration-200 ${copied ? "scale-[1.04]" : ""}`}
      >
        <span className="text-[13px] font-bold text-[var(--pvx-ink-3)]">
          Dropi
        </span>
        <span
          translate="no"
          className="pvx-num text-[24px] font-black tracking-wide"
        >
          {c.code}
        </span>
        <span
          className={
            copied ? "text-[var(--pvx-green)]" : "text-[var(--pvx-orange-text)]"
          }
        >
          {copied ? (
            <IconCheck className="w-6 h-6" />
          ) : (
            <IconCopy className="w-6 h-6" />
          )}
        </span>
      </div>
      <div className="h-5 text-[14px] font-bold text-[#3ddc84]">
        {copied ? "¡ID copiado!" : ""}
      </div>
      <span
        className={`inline-flex items-center gap-1.5 rounded-full bg-[var(--pvx-orange)] px-5 py-2.5 text-[14px] font-bold text-white ${copied && active ? "pvx-demo-press" : ""}`}
      >
        Ver en Dropi <IconExternal className="w-4 h-4" />
      </span>
    </div>
  );
}

function SceneShip({ active }: { active: boolean }) {
  const stops = ["Pedido", "Corte", "Transportadora"];
  return (
    <div className="flex h-full flex-col justify-center gap-5 px-6">
      <div className="relative mx-2 h-[60px]">
        <div className="absolute left-0 right-0 top-1/2 h-[3px] -translate-y-1/2 rounded-full bg-white/15" />
        <div
          className={`absolute left-0 top-1/2 h-[3px] -translate-y-1/2 rounded-full bg-[var(--pvx-orange)] ${active ? "pvx-demo-track" : "w-0"}`}
        />
        {stops.map((s, i) => (
          <span
            key={s}
            className="absolute top-1/2 grid h-4 w-4 -translate-x-1/2 -translate-y-1/2 place-items-center rounded-full bg-white"
            style={{ left: `${i * 50}%` }}
          >
            <span className="h-2 w-2 rounded-full bg-[var(--pvx-orange)]" />
          </span>
        ))}
        <span
          className={`absolute top-1/2 grid h-11 w-11 -translate-x-1/2 -translate-y-[130%] place-items-center rounded-xl bg-[var(--pvx-orange)] text-white ${active ? "pvx-demo-truck" : ""}`}
        >
          <IconTruck className="w-6 h-6" />
        </span>
      </div>
      <div className="flex justify-between text-[12.5px] font-semibold text-white/75">
        {stops.map((s) => (
          <span key={s}>{s}</span>
        ))}
      </div>
      <div className="flex flex-wrap items-center justify-center gap-2">
        <span className="inline-flex items-center gap-1.5 rounded-full bg-white/10 px-3 py-1.5 text-[13px] font-bold text-white">
          <IconBox className="w-4 h-4 text-[var(--pvx-orange)]" /> +3 cortes
          diarios
        </span>
        <span className="inline-flex items-center gap-1.5 rounded-full bg-white/10 px-3 py-1.5 text-[13px] font-bold text-white">
          <IconTruck className="w-4 h-4 text-[var(--pvx-orange)]" /> Sale en
          menos de 3 horas
        </span>
      </div>
    </div>
  );
}

// Productos que van rotando en cada vuelta del video (pedido del usuario
// 2026-10-15: "no siempre el mismo"): se alternan los más vendidos con
// oportunidades — con stock y en subida o con nuevo stock, pero que todavía
// se mueven menos — para que el dropshipper se anime a testearlos.
export function pickDemoCards(cards: PublicCard[]): PublicCard[] {
  const ok = cards.filter(
    (c) => c.photo && c.stock !== "out" && (c.curve ?? []).some((v) => v > 0),
  );
  const top = ok.filter((c) => c.rank <= 10);
  const opp = ok
    .filter((c) => c.rank > 10 && (c.trend === "up" || c.stock === "new"))
    .slice(0, 10);
  const out: PublicCard[] = [];
  for (let i = 0; i < Math.max(top.length, opp.length); i++) {
    if (top[i]) out.push(top[i]);
    if (opp[i]) out.push(opp[i]);
  }
  return out.length ? out : cards.slice(0, 1);
}

export function PvxDemo({ cards }: { cards: PublicCard[] }) {
  // Producto de esta vuelta: arranca en uno al azar y cambia cada vez que el video vuelve al paso 1.
  const [round, setRound] = useState(0);
  useEffect(() => {
    if (cards.length < 2) return;
    const t = setTimeout(
      () => setRound(Math.floor(Math.random() * cards.length)),
      0,
    );
    return () => clearTimeout(t);
  }, [cards.length]);
  const card = cards.length ? cards[round % cards.length] : undefined;
  const [scene, setScene] = useState(0);
  const [paused, setPaused] = useState(false);
  const [visible, setVisible] = useState(true);
  const [cycle, setCycle] = useState(0); // reinicia las animaciones al volver a una escena
  const ref = useRef<HTMLDivElement>(null);

  // Con "reducir movimiento" empieza en pausa: se pasa de escena tocándolas.
  useEffect(() => {
    if (!window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
    const t = setTimeout(() => setPaused(true), 0);
    return () => clearTimeout(t);
  }, []);

  // Solo corre si está en pantalla.
  useEffect(() => {
    const el = ref.current;
    if (!el || !("IntersectionObserver" in window)) return;
    const io = new IntersectionObserver(([e]) => setVisible(e.isIntersecting), {
      threshold: 0.3,
    });
    io.observe(el);
    return () => io.disconnect();
  }, []);

  useEffect(() => {
    if (paused || !visible) return;
    const t = setTimeout(() => {
      // Al terminar la vuelta, el siguiente producto.
      if (scene === SCENES.length - 1) setRound((r) => r + 1);
      setScene((s) => (s + 1) % SCENES.length);
      setCycle((c) => c + 1);
    }, SCENE_MS);
    return () => clearTimeout(t);
  }, [scene, paused, visible, cycle]);

  if (!card) return null;
  const running = !paused && visible;

  return (
    <figure
      ref={ref}
      data-tour="demo"
      className="w-full"
      aria-label="Cómo funciona Provedix en 4 pasos"
    >
      <div className="relative overflow-hidden rounded-[26px] bg-[var(--pvx-night-2)] ring-1 ring-white/10">
        {/* Avance por escena, como las historias. */}
        <div className="flex gap-1.5 px-4 pt-4">
          {SCENES.map((s, i) => (
            <button
              key={s}
              type="button"
              onClick={() => {
                setScene(i);
                setCycle((c) => c + 1);
              }}
              aria-label={`Paso ${i + 1}: ${s}`}
              aria-current={i === scene}
              className="group relative h-6 flex-1 cursor-pointer"
            >
              <span className="absolute inset-x-0 top-1/2 h-[4px] -translate-y-1/2 overflow-hidden rounded-full bg-white/15 group-hover:bg-white/25">
                <span
                  key={`${i}-${cycle}`}
                  className={`block h-full rounded-full bg-[var(--pvx-orange)] ${i < scene ? "w-full" : i === scene ? (running ? "pvx-demo-progress" : "w-1/2") : "w-0"}`}
                  style={
                    i === scene
                      ? { animationDuration: `${SCENE_MS}ms` }
                      : undefined
                  }
                />
              </span>
            </button>
          ))}
        </div>

        <div className="relative h-[250px] sm:h-[270px]" aria-live="polite">
          <div
            key={`${scene}-${cycle}`}
            className="pvx-demo-scene absolute inset-0"
          >
            {scene === 0 && (
              <SceneSearch c={card} active={running || scene === 0} />
            )}
            {scene === 1 && <SceneSales c={card} active />}
            {scene === 2 && <SceneCopy c={card} active />}
            {scene === 3 && <SceneShip active />}
          </div>
        </div>

        <figcaption className="flex items-center justify-between gap-3 border-t border-white/10 px-4 py-3">
          <span className="min-w-0">
            <span className="block text-[11.5px] font-semibold text-white/50">
              Paso {scene + 1} de 4
            </span>
            <span className="pvx-heading block truncate text-[17px] text-white sm:text-[19px]">
              {SCENES[scene]}
            </span>
          </span>
          <span className="flex shrink-0 items-center gap-1.5">
            <button
              type="button"
              onClick={() => setPaused(!paused)}
              aria-label={paused ? "Reproducir" : "Pausar"}
              className="pvx-press grid h-9 w-9 place-items-center rounded-full bg-white/10 text-white hover:bg-white/20 cursor-pointer"
            >
              <span aria-hidden className="text-[11px]">
                {paused ? "▶" : "❚❚"}
              </span>
            </button>
            <button
              type="button"
              onClick={() => {
                setScene((s) => (s + 1) % SCENES.length);
                setCycle((c) => c + 1);
              }}
              aria-label="Siguiente paso"
              className="pvx-press grid h-9 w-9 place-items-center rounded-full bg-white/10 text-white hover:bg-white/20 cursor-pointer"
            >
              <IconArrow className="w-4 h-4" />
            </button>
          </span>
        </figcaption>
      </div>
    </figure>
  );
}
