"use client";

import { useState } from "react";
import type { PieSlice } from "@/lib/dashboard";

// DAFLOW brand-friendly palette, cycles if there are more categories than colors.
const PALETTE = ["#14C7C7", "#1E5EFF", "#D9A441", "#C4453A", "#8B5CF6", "#22C55E", "#EC4899", "#F97316"];

export function PieChart({
  title,
  subtitle,
  slices,
  emptyMessage,
}: {
  title: string;
  subtitle?: string;
  slices: PieSlice[];
  emptyMessage: string;
}) {
  const [hoverIndex, setHoverIndex] = useState<number | null>(null);

  const total = slices.reduce((a, s) => a + s.value, 0);

  return (
    <div>
      <div className="text-[11px] font-semibold tracking-wide uppercase text-steel mb-1.5">{title}</div>
      {subtitle && <div className="text-[12px] text-steel mb-4">{subtitle}</div>}

      {(slices.length === 0 || total === 0) && (
        <div className="border-[1.5px] border-dashed border-rule rounded-md p-8.5 text-center text-steel text-[13.5px]">
          {emptyMessage}
        </div>
      )}

      {slices.length > 0 && total > 0 && (
        <div className="flex items-center gap-8 flex-wrap">
          <svg viewBox="0 0 200 200" width="180" height="180" className="shrink-0">
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

          <div className="flex-1 min-w-[180px] space-y-1.5">
            {[...slices]
              .map((s, i) => ({ ...s, i }))
              .sort((a, b) => b.value - a.value)
              .map((s) => {
                const p = Math.round((s.value / total) * 100);
                return (
                  <div
                    key={s.label}
                    className={`flex items-center gap-2 text-[12.5px] px-1.5 py-1 rounded ${hoverIndex === s.i ? "bg-cloud" : ""}`}
                    onMouseEnter={() => setHoverIndex(s.i)}
                    onMouseLeave={() => setHoverIndex(null)}
                  >
                    <span className="w-2.5 h-2.5 rounded-full shrink-0" style={{ backgroundColor: PALETTE[s.i % PALETTE.length] }} />
                    <span className="truncate">{s.label}</span>
                    <span className="ml-auto font-mono text-steel shrink-0">{p}% · {s.value}</span>
                  </div>
                );
              })}
          </div>
        </div>
      )}
    </div>
  );
}
