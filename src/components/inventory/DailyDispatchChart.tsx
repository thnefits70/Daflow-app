"use client";

import { useState } from "react";

// Pedido de Bryan 2026-10-06: unidades despachadas por día de un producto
// (últimos 30 días) en Stock Actual. units null = día antes del primer corte
// guardado en DAFLOW, no se dibuja.
export type DailyDispatchDay = { day: string; units: number | null };

const MONTH_SHORT = ["ene", "feb", "mar", "abr", "may", "jun", "jul", "ago", "sep", "oct", "nov", "dic"];
function dayLabel(day: string) {
  const [, m, d] = day.split("-");
  return `${Number(d)} ${MONTH_SHORT[Number(m) - 1]}`;
}

export function DailyDispatchChart({ days }: { days: DailyDispatchDay[] }) {
  const [hover, setHover] = useState<number | null>(null);

  const width = 560;
  const height = 170;
  const padL = 30;
  const padR = 12;
  const padT = 14;
  const padB = 24;
  const innerW = width - padL - padR;
  const innerH = height - padT - padB;

  const known = days.map((d, i) => ({ ...d, i })).filter((d): d is { day: string; units: number; i: number } => d.units !== null);
  const maxUnits = Math.max(1, ...known.map((d) => d.units));
  const yMax = maxUnits <= 4 ? maxUnits : Math.ceil(maxUnits / 2) * 2;
  const x = (i: number) => padL + (days.length <= 1 ? innerW / 2 : (i / (days.length - 1)) * innerW);
  const y = (v: number) => padT + (1 - v / yMax) * innerH;

  const line = known.map((d, k) => `${k === 0 ? "M" : "L"}${x(d.i).toFixed(1)},${y(d.units).toFixed(1)}`).join(" ");
  const area = known.length > 1 ? `${line} L${x(known[known.length - 1].i).toFixed(1)},${y(0)} L${x(known[0].i).toFixed(1)},${y(0)} Z` : "";
  const ticks = Array.from(new Set([0, Math.round(yMax / 2), yMax]));
  // Fechas debajo: cada 7 días contando desde hoy hacia atrás, para que el
  // último punto (hoy) siempre tenga su fecha.
  const dateIdx = days.map((_, i) => i).filter((i) => (days.length - 1 - i) % 7 === 0);
  const hovered = hover !== null ? days[hover] : null;

  return (
    <div>
      <svg viewBox={`0 0 ${width} ${height}`} className="w-full h-auto" onMouseLeave={() => setHover(null)}>
        {ticks.map((t) => (
          <g key={t}>
            <line x1={padL} x2={width - padR} y1={y(t)} y2={y(t)} stroke="currentColor" className="text-rule" strokeWidth={1} />
            <text x={padL - 6} y={y(t) + 3} textAnchor="end" fontSize={10} fill="currentColor" className="text-steel-dim">
              {t}
            </text>
          </g>
        ))}
        {dateIdx.map((i) => (
          <text key={i} x={x(i)} y={height - 6} textAnchor="middle" fontSize={10} fill="currentColor" className="text-steel-dim">
            {dayLabel(days[i].day)}
          </text>
        ))}
        {area && <path d={area} fill="#14C7C7" opacity={0.12} />}
        {line && <path d={line} fill="none" stroke="#14C7C7" strokeWidth={2} strokeLinejoin="round" strokeLinecap="round" />}
        {known.map((d) => (
          <circle key={d.i} cx={x(d.i)} cy={y(d.units)} r={hover === d.i ? 4 : d.units > 0 ? 2.5 : 1.5} fill="#14C7C7" />
        ))}
        {hover !== null && (
          <line x1={x(hover)} x2={x(hover)} y1={padT} y2={padT + innerH} stroke="#14C7C7" strokeDasharray="3 3" opacity={0.6} />
        )}
        {/* Franjas invisibles por día para el hover / toque en celular. */}
        {days.map((_, i) => (
          <rect
            key={i}
            x={x(i) - innerW / Math.max(1, days.length - 1) / 2}
            y={padT}
            width={innerW / Math.max(1, days.length - 1)}
            height={innerH}
            fill="transparent"
            onMouseEnter={() => setHover(i)}
            onClick={() => setHover(i)}
          />
        ))}
      </svg>
      <div className="text-[11.5px] text-center min-h-[18px] mt-1">
        {hovered ? (
          <>
            <span className="text-steel">{dayLabel(hovered.day)}: </span>
            <span className="font-bold">
              {hovered.units === null ? "sin datos (antes del primer corte guardado)" : `${hovered.units} ${hovered.units === 1 ? "unidad" : "unidades"}`}
            </span>
          </>
        ) : (
          <span className="text-steel-dim">Pasa el mouse o toca un día para ver sus unidades.</span>
        )}
      </div>
    </div>
  );
}
