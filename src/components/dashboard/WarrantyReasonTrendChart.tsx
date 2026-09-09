"use client";

import { useState } from "react";
import { smoothPath, formatMonthShort } from "./WeeklyTrendChart";
import { PALETTE } from "./PieChart";
import type { WarrantyReasonTrendSeries } from "@/lib/dashboard";

// Non-animated multi-line chart, one line per motivo — a sibling to the
// single-line WeeklyTrendChart, but that one's elaborate SMIL draw-in
// animation is built for exactly one series; four of those overlapping and
// each animating separately would be noisy. Here hovering a legend entry
// isolates that line instead, which is enough interactivity for comparing a
// handful of motivos against each other.
export function WarrantyReasonTrendChart({ series }: { series: WarrantyReasonTrendSeries[] }) {
  const [activeLabel, setActiveLabel] = useState<string | null>(null);
  const [hover, setHover] = useState<{ seriesIndex: number; pointIndex: number } | null>(null);

  if (series.length === 0 || series[0].points.length === 0) return null;

  const months = series[0].points.map((p) => p.month);
  const width = 1000;
  const height = 280;
  const padL = 40;
  const padR = 16;
  const padT = 16;
  const padB = 30;
  const innerW = width - padL - padR;
  const innerH = height - padT - padB;
  const yMax = 100;

  const stepX = months.length > 1 ? innerW / (months.length - 1) : 0;
  const xFor = (i: number) => padL + (months.length > 1 ? i * stepX : innerW / 2);
  const yFor = (v: number) => padT + innerH - (v / yMax) * innerH;

  const tickEvery = Math.max(1, Math.ceil(months.length / 12));

  return (
    <div>
      <svg
        viewBox={`0 0 ${width} ${height}`}
        width="100%"
        height={height}
        preserveAspectRatio="none"
        className="block"
        style={{ overflow: "visible" }}
        onMouseLeave={() => setHover(null)}
      >
        {[0, 25, 50, 75, 100].map((v) => {
          const y = yFor(v);
          return (
            <g key={v}>
              <line x1={padL} x2={width - padR} y1={y} y2={y} stroke="#24365a" strokeWidth="1" />
              <text x={padL - 8} y={y + 3} textAnchor="end" fontSize="10.5" fill="#92a3c0">
                {v}%
              </text>
            </g>
          );
        })}

        {months.map((m, i) =>
          i % tickEvery === 0 || i === months.length - 1 ? (
            <text key={m} x={xFor(i)} y={height - 10} textAnchor="middle" fontSize="10.5" fill="#92a3c0">
              {formatMonthShort(m)}
            </text>
          ) : null
        )}

        {series.map((s, si) => {
          const color = PALETTE[si % PALETTE.length];
          const coords = s.points.map((p, i) => ({ x: xFor(i), y: yFor(p.value) }));
          const isDimmed = activeLabel !== null && activeLabel !== s.label;
          return (
            <path
              key={s.label}
              d={smoothPath(coords)}
              fill="none"
              stroke={color}
              strokeWidth={activeLabel === s.label ? 3 : 2}
              strokeLinejoin="round"
              strokeLinecap="round"
              opacity={isDimmed ? 0.15 : 1}
              style={{ transition: "opacity 0.15s, stroke-width 0.15s" }}
            />
          );
        })}

        {series.map((s, si) => {
          const color = PALETTE[si % PALETTE.length];
          const isDimmed = activeLabel !== null && activeLabel !== s.label;
          return s.points.map((p, i) => {
            const cx = xFor(i);
            const cy = yFor(p.value);
            const isHover = hover?.seriesIndex === si && hover.pointIndex === i;
            return (
              <g key={`${s.label}-${p.month}`} opacity={isDimmed ? 0.15 : 1}>
                <circle cx={cx} cy={cy} r={isHover ? 5 : 2.75} fill={color} stroke="#0a1526" strokeWidth={isHover ? 2 : 1} />
                <circle
                  cx={cx}
                  cy={cy}
                  r={9}
                  fill="transparent"
                  style={{ cursor: "pointer" }}
                  onMouseEnter={() => setHover({ seriesIndex: si, pointIndex: i })}
                />
              </g>
            );
          });
        })}

        {hover &&
          (() => {
            const s = series[hover.seriesIndex];
            const p = s.points[hover.pointIndex];
            const cx = xFor(hover.pointIndex);
            const cy = yFor(p.value);
            const color = PALETTE[hover.seriesIndex % PALETTE.length];
            const line2 = `${s.label}: ${p.value}%`;
            const boxW = Math.max(90, line2.length * 6.2 + 18);
            const boxX = Math.max(padL, Math.min(cx - boxW / 2, width - padR - boxW));
            const boxY = Math.max(4, cy - 50);
            return (
              <g pointerEvents="none">
                <rect x={boxX} y={boxY} width={boxW} height={38} rx="5" fill="#101f3b" stroke="#24365a" strokeWidth="1" />
                <text x={boxX + boxW / 2} y={boxY + 15} textAnchor="middle" fontSize="10.5" fill="#92a3c0">
                  {formatMonthShort(p.month)}
                </text>
                <text x={boxX + boxW / 2} y={boxY + 30} textAnchor="middle" fontSize="12" fontWeight="700" fill={color}>
                  {line2}
                </text>
              </g>
            );
          })()}
      </svg>

      <div className="flex flex-wrap gap-3.5 mt-3 pt-3 border-t border-dashed border-rule">
        {series.map((s, si) => (
          <button
            key={s.label}
            type="button"
            className="flex items-center gap-1.5 text-[11.5px] cursor-pointer"
            style={{ color: activeLabel === s.label ? PALETTE[si % PALETTE.length] : undefined }}
            onMouseEnter={() => setActiveLabel(s.label)}
            onMouseLeave={() => setActiveLabel(null)}
          >
            <span className="w-2 h-2 rounded-full shrink-0" style={{ background: PALETTE[si % PALETTE.length] }} />
            {s.label}
          </button>
        ))}
      </div>
    </div>
  );
}
