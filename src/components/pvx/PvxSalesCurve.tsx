"use client";

// Curva de ventas del producto en provedix.com (pedido del usuario
// 2026-10-12): solo la forma — cómo se movió el volumen día a día en los
// últimos 30 días —, sin fechas ni cifras. Los valores ya vienen 0–100 y
// suavizados desde el resumen (salesCurve en provedixSnapshot.ts).
// También va chica en cada tarjeta del catálogo (height + 7/30 días).
// Con `tips` (rango de ventas de cada día, ej. "6–10 ventas ese día") al
// pasar el mouse o tocar la curva se ve el rango de ese día — nunca la
// cifra exacta (opción "b" elegida por el usuario 2026-10-12).

import { useId, useState } from "react";

const W = 300;
const PAD = 4;

// Curva suave que pasa por cada punto (Catmull-Rom → Bézier), sin pasarse
// de los bordes.
function smoothPath(pts: [number, number][], H: number): string {
  if (pts.length < 2) return "";
  let d = `M${pts[0][0]},${pts[0][1]}`;
  for (let i = 0; i < pts.length - 1; i++) {
    const [x0, y0] = pts[Math.max(0, i - 1)];
    const [x1, y1] = pts[i];
    const [x2, y2] = pts[i + 1];
    const [x3, y3] = pts[Math.min(pts.length - 1, i + 2)];
    const clamp = (y: number) => Math.min(H - PAD, Math.max(PAD, y));
    const c1x = x1 + (x2 - x0) / 6;
    const c1y = clamp(y1 + (y2 - y0) / 6);
    const c2x = x2 - (x3 - x1) / 6;
    const c2y = clamp(y2 - (y3 - y1) / 6);
    d += ` C${c1x.toFixed(1)},${c1y.toFixed(1)} ${c2x.toFixed(1)},${c2y.toFixed(1)} ${x2.toFixed(1)},${y2.toFixed(1)}`;
  }
  return d;
}

export function PvxSalesCurve({ values, height = 70, labels = true, tips }: { values: number[]; height?: number; labels?: boolean; tips?: string[] }) {
  const H = height;
  const gradientId = `pvx-curve-${useId().replace(/:/g, "")}`;
  const [active, setActive] = useState<number | null>(null);
  const step = (W - PAD * 2) / Math.max(1, values.length - 1);
  const pts = values.map((v, i): [number, number] => [PAD + i * step, H - PAD - (v / 100) * (H - PAD * 2)]);
  const line = smoothPath(pts, H);
  const area = `${line} L${pts[pts.length - 1][0]},${H} L${pts[0][0]},${H} Z`;
  const interactive = !!tips && tips.length === values.length;

  function pick(e: React.PointerEvent<HTMLDivElement>) {
    if (!interactive) return;
    const r = e.currentTarget.getBoundingClientRect();
    const x = ((e.clientX - r.left) / r.width) * W;
    setActive(Math.min(values.length - 1, Math.max(0, Math.round((x - PAD) / step))));
  }

  const leftPct = active == null ? 0 : (pts[active][0] / W) * 100;
  return (
    <div>
      <div
        className={`relative ${interactive ? "cursor-crosshair touch-none" : ""}`}
        onPointerMove={pick}
        onPointerDown={pick}
        onPointerLeave={() => setActive(null)}
      >
        <svg viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none" className="w-full block" style={{ height: H }} aria-label="Curva de ventas" role="img">
          <defs>
            <linearGradient id={gradientId} x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor="#F95B02" stopOpacity="0.28" />
              <stop offset="100%" stopColor="#F95B02" stopOpacity="0" />
            </linearGradient>
          </defs>
          <path d={area} fill={`url(#${gradientId})`} />
          <path d={line} fill="none" stroke="#F95B02" strokeWidth="2.25" strokeLinecap="round" strokeLinejoin="round" vectorEffect="non-scaling-stroke" />
        </svg>
        {interactive && active != null && (
          <>
            <div className="absolute top-0 bottom-0 w-px bg-[#F95B02]/40 pointer-events-none" style={{ left: `${leftPct}%` }} />
            <div
              className="absolute w-2.5 h-2.5 -ml-[5px] -mt-[5px] rounded-full bg-white border-2 border-[#F95B02] pointer-events-none"
              style={{ left: `${leftPct}%`, top: pts[active][1] }}
            />
            <div
              className="absolute -top-1 whitespace-nowrap rounded-md bg-[#111214] text-white text-[11px] font-semibold px-2 py-0.5 pointer-events-none"
              style={{ left: `${leftPct}%`, transform: `translate(${leftPct > 70 ? "-100%" : leftPct < 30 ? "0" : "-50%"}, -100%)` }}
            >
              {tips![active]}
            </div>
          </>
        )}
      </div>
      {labels && (
        <div className="flex justify-between text-[10px] text-[#6B717B] mt-0.5">
          <span>Antes</span>
          <span>{interactive ? "Toca la curva para ver cada día" : "Reciente"}</span>
        </div>
      )}
    </div>
  );
}

// Barras día por día para la ficha (2026-10-14): la curva suavizada mostraba
// picos en días "Sin ventas" (promedio de 3 días vs. el rango exacto del día).
// Acá cada barra ES un día: su alto sale del mismo rango que dice el globito,
// así nunca se contradicen. Sin fechas ni cifras exactas, como siempre.
const LEVELS = ["Sin ventas ese día", "1–5 ventas ese día", "6–10 ventas ese día", "11–20 ventas ese día", "21–50 ventas ese día", "51–100 ventas ese día", "Más de 100 ventas ese día"];

// heightClass: alto de las barras según la pantalla (más bajas en celular).
export function PvxDailyBars({ ranges, heightClass = "h-[150px]" }: { ranges: string[]; heightClass?: string }) {
  const levels = ranges.map((r) => Math.max(0, LEVELS.indexOf(r)));
  const top = Math.max(...levels, 1);
  const lastSale = levels.reduce((acc, l, i) => (l > 0 ? i : acc), -1);
  const [active, setActive] = useState<number | null>(null);
  const shown = active ?? (lastSale >= 0 ? lastSale : null);
  const soldDays = levels.filter((l) => l > 0).length;
  return (
    <div>
      <div className="flex items-baseline justify-between gap-2">
        <span className="text-[12.5px] text-[#4A4F58]">
          Vendió <b className="text-[#111214]">{soldDays} de {ranges.length} días</b>
        </span>
        <span className="min-h-[1.25em] text-right text-[12.5px] font-bold text-[#111214]" aria-live="polite">
          {shown != null ? `${active == null ? "Último día con ventas: " : ""}${ranges[shown].replace(" ese día", "")}` : ""}
        </span>
      </div>
      <div className={`mt-2 flex items-end gap-[2px] sm:gap-[3px] ${heightClass}`} onPointerLeave={() => setActive(null)} role="img" aria-label={`Ventas por día de los últimos ${ranges.length} días`}>
        {levels.map((l, i) => (
          <button
            key={i}
            type="button"
            tabIndex={-1}
            aria-hidden
            onPointerEnter={() => setActive(i)}
            onPointerDown={() => setActive(i)}
            className="group relative flex h-full flex-1 cursor-pointer items-end"
          >
            <span
              className={`block w-full rounded-t-[4px] transition-colors duration-150 ${l === 0 ? "bg-[#E2E2DE]" : shown === i ? "bg-[#111214]" : "bg-[#F95B02] group-hover:bg-[#DD4F00]"}`}
              style={{ height: l === 0 ? 3 : `${Math.max(10, (l / top) * 100)}%` }}
            />
          </button>
        ))}
      </div>
      <div className="mt-1 flex justify-between text-[11px] text-[#6B717B]">
        <span>Antes</span>
        <span>Toca una barra para ver ese día</span>
        <span>Reciente</span>
      </div>
    </div>
  );
}
