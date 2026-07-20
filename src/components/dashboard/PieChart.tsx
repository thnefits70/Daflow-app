"use client";

import { useState } from "react";
import { TrendingUp, TrendingDown } from "lucide-react";
import type { PieSlice } from "@/lib/dashboard";
import { formatMonthShort } from "./WeeklyTrendChart";

// DAFLOW brand-friendly palette, cycles if there are more categories than colors.
const PALETTE = ["#14C7C7", "#1E5EFF", "#D9A441", "#C4453A", "#8B5CF6", "#22C55E", "#EC4899", "#F97316"];

// Compares each category's SHARE of the total (not raw count) between the
// two halves of the trailing-12-month window — see getWarrantyReasonChart().
function TrendIcon({ trend, size = 11 }: { trend?: "up" | "down"; size?: number }) {
  if (trend === "up") return <TrendingUp size={size} className="shrink-0" style={{ color: "#22C55E" }} />;
  if (trend === "down") return <TrendingDown size={size} className="shrink-0" style={{ color: "#E0574A" }} />;
  return null;
}

export function PieChart({
  title,
  subtitle,
  month,
  enteredTotal,
  slices,
  emptyMessage,
  compact,
}: {
  title: string;
  subtitle?: string;
  // formatMonthShort() is only exported from a "use client" module, so the
  // month label is built here (already client-side) instead of by a server
  // component passing a pre-formatted string as `subtitle`.
  month?: string;
  enteredTotal?: number;
  slices: PieSlice[];
  emptyMessage: string;
  // Tile-sized version for the Inicio KPI grid — smaller pie, condensed
  // legend (top 4 by value), no title/subtitle header (the caller renders
  // that itself via KpiTile so it looks identical to the other tiles).
  compact?: boolean;
}) {
  const [hoverIndex, setHoverIndex] = useState<number | null>(null);

  const total = slices.reduce((a, s) => a + s.value, 0);
  const resolvedSubtitle = month ? `${formatMonthShort(month)} · ${enteredTotal ?? 0} ingresadas` : subtitle;
  const size = compact ? 58 : 180;

  const pieSvg = (
    <svg viewBox="0 0 200 200" width={size} height={size} className="shrink-0">
      {(() => {
        let angle = -Math.PI / 2;
        const cx = 100;
        const cy = 100;
        const r = 90;
        return slices.map((s, i) => {
          const sliceAngle = (s.value / total) * 2 * Math.PI;
          const startAngle = angle;
          const endAngle = angle + sliceAngle;
          angle = endAngle;
          const x1 = cx + r * Math.cos(startAngle);
          const y1 = cy + r * Math.sin(startAngle);
          const x2 = cx + r * Math.cos(endAngle);
          const y2 = cy + r * Math.sin(endAngle);
          const largeArc = sliceAngle > Math.PI ? 1 : 0;
          const path =
            slices.length === 1
              ? `M${cx},${cy - r} A${r},${r} 0 1 1 ${cx - 0.01},${cy - r} Z`
              : `M${cx},${cy} L${x1.toFixed(2)},${y1.toFixed(2)} A${r},${r} 0 ${largeArc} 1 ${x2.toFixed(2)},${y2.toFixed(2)} Z`;
          const isHover = i === hoverIndex;
          return (
            <path
              key={s.label}
              d={path}
              fill={PALETTE[i % PALETTE.length]}
              opacity={hoverIndex === null || isHover ? 1 : 0.45}
              stroke="#0a1526"
              strokeWidth={isHover ? 2 : 1}
              onMouseEnter={() => setHoverIndex(i)}
              onMouseLeave={() => setHoverIndex(null)}
              style={{ cursor: "pointer" }}
            />
          );
        });
      })()}
    </svg>
  );

  if (slices.length === 0 || total === 0) {
    return compact ? (
      <div className="text-[11px] text-steel">{emptyMessage}</div>
    ) : (
      <div>
        <div className="text-[11px] font-semibold tracking-wide uppercase text-steel mb-1.5">{title}</div>
        {resolvedSubtitle && <div className="text-[12px] text-steel mb-4">{resolvedSubtitle}</div>}
        <div className="border-[1.5px] border-dashed border-rule rounded-md p-8.5 text-center text-steel text-[13.5px]">
          {emptyMessage}
        </div>
      </div>
    );
  }

  const ranked = [...slices].map((s, i) => ({ ...s, i })).sort((a, b) => b.value - a.value);

  if (compact) {
    const shown = ranked.slice(0, 4);
    const restCount = ranked.length - shown.length;
    return (
      <div className="flex items-center gap-3">
        {pieSvg}
        <div className="flex-1 min-w-0 text-[10.5px] text-steel leading-relaxed">
          {shown.map((s) => (
            <div key={s.label} className="flex items-center justify-between gap-2">
              <span className="flex items-center gap-1.5 min-w-0">
                <span className="w-1.5 h-1.5 rounded-full shrink-0" style={{ background: PALETTE[s.i % PALETTE.length] }} />
                <span className="truncate">{s.label}</span>
              </span>
              <span className="font-mono text-ink shrink-0 inline-flex items-center gap-1">
                {s.value} · {Math.round((s.value / total) * 100)}%
                <TrendIcon trend={s.trend} />
              </span>
            </div>
          ))}
          {restCount > 0 && <div className="text-steel/70">+{restCount} más</div>}
        </div>
      </div>
    );
  }

  return (
    <div>
      <div className="text-[11px] font-semibold tracking-wide uppercase text-steel mb-1.5">{title}</div>
      {resolvedSubtitle && <div className="text-[12px] text-steel mb-4">{resolvedSubtitle}</div>}

      <div className="flex items-center gap-8 flex-wrap">
        {pieSvg}

        <div className="flex-1 min-w-[180px] space-y-1.5">
          {ranked.map((s) => {
            const p = Math.round((s.value / total) * 100);
            return (
              <div
                key={s.label}
                className={`inline-flex w-fit max-w-full items-center gap-2 text-[12.5px] px-1.5 py-1 rounded ${hoverIndex === s.i ? "bg-cloud" : ""}`}
                onMouseEnter={() => setHoverIndex(s.i)}
                onMouseLeave={() => setHoverIndex(null)}
              >
                <span className="w-2.5 h-2.5 rounded-full shrink-0" style={{ backgroundColor: PALETTE[s.i % PALETTE.length] }} />
                <span className="truncate max-w-[160px]">{s.label}</span>
                <span className="font-mono text-steel shrink-0 inline-flex items-center gap-1">
                  {p}% · {s.value}
                  <TrendIcon trend={s.trend} size={12} />
                </span>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}
