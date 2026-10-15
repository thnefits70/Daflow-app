"use client";

import { useEffect, useState } from "react";

// "Video" de cómo usar la calculadora (pedido del usuario 2026-10-15): una
// animación en vivo, igual que PvxDemo de la portada (no un archivo de video,
// así carga al instante). Se ve mientras el dropshipper todavía no escribe
// nada. 4 pasos de ~3 s que se repiten; con "reducir movimiento" queda quieto
// en el resultado. Los números son los del ejemplo real de las fórmulas:
// $5 en Dropi, flete $7, CPA $5, ganancia $5 → $26,99 y CPA máximo $8,47.

const TICK = 100; // ms
const LOOP = 130; // ticks (13 s)
const STEPS = [
  { from: 0, title: "Escribe el precio en Dropi" },
  { from: 32, title: "Ajusta tu flete y tu CPA" },
  { from: 60, title: "Te damos el precio para ganar" },
  { from: 98, title: "Y cuánto puedes pagar de publicidad" },
];

const money = (n: number) =>
  `$${n.toLocaleString("es-EC", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

export function PvxCalcDemo({ onTry }: { onTry: () => void }) {
  const [t, setT] = useState(0);
  useEffect(() => {
    const still = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    if (still) {
      const s = setTimeout(() => setT(LOOP - 1), 0);
      return () => clearTimeout(s);
    }
    const id = setInterval(() => setT((x) => (x + 1) % LOOP), TICK);
    return () => clearInterval(id);
  }, []);

  const step = STEPS.reduce((acc, s, i) => (t >= s.from ? i : acc), 0);
  const typed = "5,00".slice(
    0,
    Math.max(0, Math.min(4, Math.floor((t - 6) / 4))),
  );
  const showCosts = t >= 36;
  const countUp = Math.min(1, Math.max(0, (t - 62) / 16));
  const price = 26.99 * (1 - Math.pow(1 - countUp, 3));
  const showBadge = t >= 80;
  const showCpa = t >= 100;

  return (
    <div
      className="flex h-full min-h-[300px] flex-col"
      aria-label="Animación: cómo usar la calculadora"
    >
      <div className="flex gap-1.5" aria-hidden>
        {STEPS.map((s, i) => (
          <span
            key={s.from}
            className="h-1 flex-1 overflow-hidden rounded-full bg-white/15"
          >
            <span
              className="block h-full rounded-full bg-[var(--pvx-orange)] transition-[width] duration-100"
              style={{
                width:
                  i < step
                    ? "100%"
                    : i === step
                      ? `${Math.min(100, ((t - s.from) / ((STEPS[i + 1]?.from ?? LOOP) - s.from)) * 100)}%`
                      : "0%",
              }}
            />
          </span>
        ))}
      </div>
      <p className="mt-4 text-[12px] font-semibold text-white/55">
        Así funciona · Paso {step + 1} de 4
      </p>
      <p className="pvx-heading mt-1 text-[22px] sm:text-[24px]">
        {STEPS[step].title}
      </p>

      <div className="mt-5 flex-1 space-y-2.5">
        {/* Paso 1: precio en Dropi */}
        <div
          className={`rounded-2xl bg-white px-3.5 py-2.5 text-[var(--pvx-ink)] transition-shadow ${step === 0 ? "ring-2 ring-[var(--pvx-orange)]" : ""}`}
        >
          <p className="text-[11px] font-bold text-[var(--pvx-ink-2)]">
            Precio en Dropi (por unidad)
          </p>
          <p className="pvx-num text-[18px] font-bold">
            $ {typed}
            {step === 0 && (
              <span className="ml-0.5 inline-block h-[18px] w-[2px] translate-y-[3px] animate-pulse bg-[var(--pvx-orange)]" />
            )}
          </p>
        </div>
        {/* Paso 2: flete y CPA */}
        <div
          className={`grid grid-cols-2 gap-2.5 transition-all duration-500 ${showCosts ? "translate-y-0 opacity-100" : "translate-y-2 opacity-0"}`}
        >
          {[
            ["Flete", "$ 7,00"],
            ["CPA (publicidad)", "$ 5,00"],
          ].map(([k, v]) => (
            <div
              key={k}
              className={`rounded-2xl bg-white px-3.5 py-2.5 text-[var(--pvx-ink)] ${step === 1 ? "ring-2 ring-[var(--pvx-orange)]" : ""}`}
            >
              <p className="text-[11px] font-bold text-[var(--pvx-ink-2)]">
                {k}
              </p>
              <p className="pvx-num text-[16px] font-bold">{v}</p>
            </div>
          ))}
        </div>
        {/* Paso 3: precio recomendado */}
        <div
          className={`rounded-2xl bg-white/[0.06] px-3.5 py-3 transition-opacity duration-300 ${t >= 60 ? "opacity-100" : "opacity-0"}`}
        >
          <div className="flex items-start justify-between gap-2">
            <div>
              <p className="text-[11.5px] text-white/60">
                Precio recomendado al público
              </p>
              <p className="pvx-display pvx-num text-[40px] leading-none text-[var(--pvx-orange)]">
                {money(price)}
              </p>
            </div>
            <span
              className={`shrink-0 rounded-full bg-[#e3f6ea] px-2.5 py-1 text-[11.5px] font-bold text-[#0f7239] transition-all duration-300 ${showBadge ? "scale-100 opacity-100" : "scale-75 opacity-0"}`}
            >
              🟢 Rentable
            </span>
          </div>
        </div>
        {/* Paso 4: CPA máximo */}
        <div
          className={`grid grid-cols-2 gap-2.5 transition-all duration-500 ${showCpa ? "translate-y-0 opacity-100" : "translate-y-2 opacity-0"}`}
        >
          <div
            className={`rounded-2xl bg-white/[0.06] px-3.5 py-2.5 ${step === 3 ? "ring-2 ring-[var(--pvx-orange)]" : ""}`}
          >
            <p className="text-[11px] text-white/60">CPA máximo sin perder</p>
            <p className="pvx-num text-[18px] font-bold">$8,47</p>
          </div>
          <div className="rounded-2xl bg-white/[0.06] px-3.5 py-2.5">
            <p className="text-[11px] text-white/60">Ganas por pedido</p>
            <p className="pvx-num text-[18px] font-bold">$5,43</p>
          </div>
        </div>
      </div>

      <button
        type="button"
        onClick={onTry}
        className="pvx-press mt-5 w-full rounded-full bg-[var(--pvx-orange)] px-4 py-3 text-[14.5px] font-bold text-white hover:bg-[var(--pvx-orange-press)] cursor-pointer"
      >
        Probar con este ejemplo
      </button>
      <p className="mt-2 text-center text-[12px] text-white/55">
        o escribe el precio en Dropi de tu producto 👈
      </p>
    </div>
  );
}
