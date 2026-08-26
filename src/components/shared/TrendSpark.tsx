"use client";

import { useState } from "react";

// Mini-gráfica de tendencia con un punto de luz que viaja de izquierda a
// derecha sobre la línea — rojo si la tendencia es mala, verde si es buena,
// gris si todavía no hay suficiente historial. Compartida entre KPIs
// financieros → Inventario e Inicio (confirmado 2026-08-04).
//
// Modo "detailed" (2026-08-25/26): cada mes real es un punto visible con su
// mes y su valor, y es clickeable — al tocarlo muestra debajo una explicación
// en lenguaje simple de qué pasó ese mes (texto vía prop `explanations`,
// alineado 1:1 con `values`/`periods`, calculado por quien use el componente
// porque solo esa capa conoce el detalle del KPI). Sin selección, se muestra
// el mes más reciente por defecto. Solo se activa donde hay espacio (panel
// de Finanzas), no en la tarjeta compacta de Inicio.

const MONTH_SHORT = ["Ene", "Feb", "Mar", "Abr", "May", "Jun", "Jul", "Ago", "Sep", "Oct", "Nov", "Dic"];
function shortMonthLabel(period: string | null | undefined) {
  if (!period) return "";
  const [, m] = period.split("-");
  return MONTH_SHORT[Number(m) - 1] ?? period;
}

function buildSparkPoints(
  values: (number | null)[],
  width: number,
  plotHeight: number,
  padX: number,
  padTop: number,
  padBottom: number,
) {
  const pts = values.map((v, i) => ({ v, i })).filter((p): p is { v: number; i: number } => p.v !== null);
  if (pts.length < 2) return null;
  const xs = pts.map((p) => p.i);
  const ys = pts.map((p) => p.v);
  const minX = Math.min(...xs), maxX = Math.max(...xs);
  const minY = Math.min(...ys), maxY = Math.max(...ys);
  const spanX = maxX - minX || 1;
  const spanY = maxY - minY || 1;
  return pts.map((p) => ({
    x: padX + ((p.i - minX) / spanX) * (width - padX * 2),
    y: padTop + (1 - (p.v - minY) / spanY) * (plotHeight - padTop - padBottom),
    v: p.v,
    i: p.i,
  }));
}

export function TrendSpark({
  values,
  good,
  height = 54,
  periods,
  valueFormatter,
  detailed = false,
  explanations,
}: {
  values: (number | null)[];
  good: boolean | null;
  height?: number;
  /** periodos "YYYY-MM" alineados 1:1 con `values`, solo se usan en modo detailed */
  periods?: (string | null)[];
  /** cómo mostrar el valor de cada punto, ej. (v) => `${v}d` */
  valueFormatter?: (v: number) => string;
  detailed?: boolean;
  /** texto simple de "qué pasó" para cada índice de `values`; si se da, los puntos son clickeables */
  explanations?: (string | null)[];
}) {
  const [selectedIdx, setSelectedIdx] = useState<number | null>(null);
  const width = 320;
  const padX = detailed ? 22 : 6;
  const padTop = detailed ? 16 : 6;
  const padBottom = detailed ? 15 : 6;
  const totalHeight = detailed ? height + padTop + padBottom : height;

  const points = buildSparkPoints(values, width, totalHeight, padX, padTop, padBottom);
  const color = good === false ? "#e0574a" : good === true ? "#22a67e" : "#92a3c0";

  if (!points) return <div className="text-[11px] text-steel py-2">Aún no hay suficientes meses para ver tendencia.</div>;

  const path = "M" + points.map((p) => `${p.x.toFixed(1)},${p.y.toFixed(1)}`).join(" L");
  const fmt = valueFormatter ?? ((v: number) => v.toFixed(0));
  const glowId = `glow-${Math.random().toString(36).slice(2)}`;

  const activeIdx = selectedIdx !== null && selectedIdx < points.length ? selectedIdx : points.length - 1;
  const activePoint = points[activeIdx];
  const activeExplanation = explanations ? explanations[activePoint.i] ?? null : null;

  return (
    <div>
      <svg width="100%" height={totalHeight} viewBox={`0 0 ${width} ${totalHeight}`} preserveAspectRatio="none">
        <defs>
          <filter id={glowId} x="-100%" y="-100%" width="300%" height="300%">
            <feGaussianBlur stdDeviation="3" result="blur" />
            <feMerge><feMergeNode in="blur" /><feMergeNode in="SourceGraphic" /></feMerge>
          </filter>
        </defs>
        <path d={path} fill="none" stroke={color} strokeWidth="2.5" />
        {detailed && points.map((p, idx) => {
          const isFirst = idx === 0;
          const isLast = idx === points.length - 1;
          const isActive = idx === activeIdx;
          const dotColor = isFirst ? "#92a3c0" : color;
          const textColor = isFirst ? "#92a3c0" : color;
          return (
            <g
              key={p.i}
              onClick={explanations ? () => setSelectedIdx(idx) : undefined}
              style={{ cursor: explanations ? "pointer" : "default" }}
            >
              {explanations && <circle cx={p.x} cy={p.y} r={9} fill="transparent" />}
              {isActive && <circle cx={p.x} cy={p.y} r={6.5} fill={dotColor} opacity={0.25} />}
              <circle
                cx={p.x}
                cy={p.y}
                r={isActive ? 4.5 : isFirst || isLast ? 3.5 : 2.5}
                fill={dotColor}
                opacity={isFirst || isLast || isActive ? 1 : 0.7}
                stroke={isActive ? "#fff" : "none"}
                strokeWidth={isActive ? 1.2 : 0}
              />
              <text
                x={p.x}
                y={p.y - 7}
                fontSize={isFirst || isLast ? 9.5 : 7.5}
                fontWeight={isLast ? 700 : 400}
                fill={textColor}
                opacity={isFirst || isLast ? 1 : 0.8}
                textAnchor="middle"
              >
                {fmt(p.v)}
              </text>
              <text
                x={p.x}
                y={p.y + 13}
                fontSize={isFirst || isLast ? 8.5 : 7}
                fill={textColor}
                opacity={isFirst || isLast ? 1 : 0.65}
                textAnchor="middle"
              >
                {shortMonthLabel(periods?.[p.i])}
              </text>
            </g>
          );
        })}
        <circle r="4" fill={color} filter={`url(#${glowId})`}>
          <animateMotion dur="3.2s" repeatCount="indefinite" path={path} />
        </circle>
      </svg>
      {detailed && explanations && (
        <div className="mt-1.5 text-[11px] text-steel bg-cloud/60 border border-rule rounded-md px-2.5 py-2 leading-snug">
          <span className="font-semibold text-ink">{shortMonthLabel(periods?.[activePoint.i])}: </span>
          {activeExplanation ?? "Toca un punto de la línea para ver qué pasó ese mes."}
        </div>
      )}
    </div>
  );
}
