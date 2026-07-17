"use client";

import { useState } from "react";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { formatWeekShort } from "./WeeklyTrendChart";
import type { StockoutWeekPoint } from "@/lib/dashboard";

const WINDOW_SIZE = 4;

export function StockoutBarChart({ points }: { points: StockoutWeekPoint[] }) {
  const [offset, setOffset] = useState(0);
  const [hoverIndex, setHoverIndex] = useState<number | null>(null);

  if (points.length === 0) return null;

  const end = points.length - offset;
  const start = Math.max(0, end - WINDOW_SIZE);
  const visible = points.slice(start, end);
  const canGoBack = start > 0;
  const canGoForward = offset > 0;

  const latest = points[points.length - 1];

  const width = 1000;
  const height = 300;
  const padL = 40;
  const padR = 20;
  const padT = 16;
  const padB = 34;
  const innerW = width - padL - padR;
  const innerH = height - padT - padB;

  const rawMax = Math.max(...visible.map((p) => p.value), 1);
  const yMax = Math.max(rawMax + 1, 4);
  const yTicks = 4;

  const slotW = innerW / visible.length;
  const barW = Math.min(64, slotW * 0.5);

  return (
    <div>
      <div className="flex items-start justify-between flex-wrap gap-4 mb-5">
        <div>
          <div className="text-[11px] font-semibold tracking-wide uppercase text-steel mb-1.5">
            Ruptura de Stock · General
          </div>
          <div className="flex items-baseline gap-2.5">
            <span className="font-display text-[32px] font-bold text-ink leading-none">{latest.value}</span>
            <span className="text-[12px] text-steel">{formatWeekShort(latest.week)} (última semana) · productos distintos</span>
          </div>
        </div>
        <div className="flex items-center gap-1.5">
          <button
            type="button"
            className="p-1.5 border border-rule rounded cursor-pointer disabled:opacity-30 disabled:cursor-default"
            disabled={!canGoBack}
            onClick={() => setOffset((o) => o + WINDOW_SIZE)}
            aria-label="Semanas anteriores"
          >
            <ChevronLeft size={14} />
          </button>
          <span className="text-[11.5px] text-steel w-28 text-center">
            {formatWeekShort(visible[0].week)} – {formatWeekShort(visible[visible.length - 1].week)}
          </span>
          <button
            type="button"
            className="p-1.5 border border-rule rounded cursor-pointer disabled:opacity-30 disabled:cursor-default"
            disabled={!canGoForward}
            onClick={() => setOffset((o) => Math.max(0, o - WINDOW_SIZE))}
            aria-label="Semanas más recientes"
          >
            <ChevronRight size={14} />
          </button>
        </div>
      </div>

      <svg
        viewBox={`0 0 ${width} ${height}`}
        width="100%"
        height={height}
        preserveAspectRatio="none"
        className="block"
        onMouseLeave={() => setHoverIndex(null)}
      >
        {Array.from({ length: yTicks + 1 }).map((_, i) => {
          const v = Math.round((yMax / yTicks) * i);
          const y = padT + innerH - (v / yMax) * innerH;
          return (
            <g key={i}>
              <line x1={padL} x2={width - padR} y1={y} y2={y} stroke="#24365a" strokeWidth="1" />
              <text x={padL - 10} y={y + 3} textAnchor="end" fontSize="11" fill="#92a3c0">
                {v}
              </text>
            </g>
          );
        })}

        {visible.map((p, i) => {
          const slotX = padL + i * slotW;
          const barX = slotX + (slotW - barW) / 2;
          const barH = (p.value / yMax) * innerH;
          const barY = padT + innerH - barH;
          const isHover = i === hoverIndex;
          return (
            <g key={p.week}>
              <rect
                x={barX}
                y={barY}
                width={barW}
                height={Math.max(barH, 2)}
                rx="4"
                fill={isHover ? "#14C7C7" : "#14C7C7cc"}
                onMouseEnter={() => setHoverIndex(i)}
                onClick={() => setHoverIndex((v) => (v === i ? null : i))}
                style={{ cursor: "pointer" }}
              />
              <text x={slotX + slotW / 2} y={barY - 8} textAnchor="middle" fontSize="12" fontWeight="700" fill="#f1f5fb">
                {p.value}
              </text>
              <text x={slotX + slotW / 2} y={height - 10} textAnchor="middle" fontSize="10.5" fill="#92a3c0">
                {formatWeekShort(p.week)}
              </text>
            </g>
          );
        })}

        {hoverIndex !== null &&
          (() => {
            const p = visible[hoverIndex];
            const slotX = padL + hoverIndex * slotW;
            const label = p.products.length > 0 ? p.products.join(", ") : "Sin productos";
            const boxW = Math.min(320, Math.max(140, label.length * 6.2 + 24));
            const barH = (p.value / yMax) * innerH;
            const barY = padT + innerH - barH;
            const boxX = Math.max(padL, Math.min(slotX + slotW / 2 - boxW / 2, width - padR - boxW));
            const boxY = Math.max(4, barY - 50);
            return (
              <g pointerEvents="none">
                <rect x={boxX} y={boxY} width={boxW} height={40} rx="6" fill="#101f3b" stroke="#24365a" strokeWidth="1" />
                <text x={boxX + boxW / 2} y={boxY + 16} textAnchor="middle" fontSize="10.5" fill="#92a3c0">
                  {formatWeekShort(p.week)}
                </text>
                <text x={boxX + boxW / 2} y={boxY + 31} textAnchor="middle" fontSize="11" fill="#f1f5fb">
                  {label}
                </text>
              </g>
            );
          })()}
      </svg>
    </div>
  );
}
