"use client";

import { useId, useState } from "react";
import {
  smoothPath,
  formatWeekShort,
  formatMonthShort,
  formatIsoWeekRangeLabel,
  fillRateStatus,
  returnRateStatus,
} from "./WeeklyTrendChart";
import { PieChart } from "./PieChart";
import type { WeeklyTrend, WarrantyMonthlyChart } from "@/lib/dashboard";

export function KpiTile({
  kicker,
  value,
  period,
  pill,
  className,
  children,
}: {
  kicker: string;
  value: string;
  period: string;
  pill?: { label: string; color: string };
  className?: string;
  children: React.ReactNode;
}) {
  return (
    <div className={`bg-surface border border-rule rounded-lg p-4 ${className ?? ""}`}>
      <div className="font-mono text-[9.5px] font-semibold uppercase tracking-wide text-steel mb-2">{kicker}</div>
      <div className="flex items-baseline gap-2 flex-wrap mb-0.5">
        <span className="font-display text-[22px] font-bold leading-none">{value}</span>
        {pill && (
          <span
            className="font-mono text-[8.5px] font-bold tracking-wide px-1.5 py-0.5 rounded-full"
            style={{ color: pill.color, border: `1px solid ${pill.color}`, background: `${pill.color}22` }}
          >
            {pill.label}
          </span>
        )}
      </div>
      <div className="text-[10.5px] text-steel mb-2.5">{period}</div>
      {children}
    </div>
  );
}

// Hovering a point shows "S23 · 16–22 jun 2026 · 97%" (week + its actual
// calendar date range + value) in one step — the date range is the same
// isoWeekDateRange() data the full-size WeeklyTrendChart shows on a
// click, just surfaced immediately on hover since there's no room in a
// compact tile for a separate click-to-reveal step. formatIsoWeekRangeLabel()
// returns null for month-shaped periods (Tasa de Devolución), so it's simply
// omitted there.
export function MiniSparkline({
  points,
  color,
  formatPeriod,
  formatValue,
}: {
  points: { week: string; value: number }[];
  color: string;
  formatPeriod: (period: string) => string;
  formatValue: (value: number) => string;
}) {
  const uid = useId();
  const [hoverIndex, setHoverIndex] = useState<number | null>(null);
  const w = 220;
  const h = 40;
  const padY = 5;
  const values = points.map((p) => p.value);
  const max = Math.max(...values);
  const min = Math.min(...values);
  const range = max - min || 1;
  const innerH = h - padY * 2;
  const stepX = values.length > 1 ? w / (values.length - 1) : 0;
  const coords = values.map((v, i) => ({ x: i * stepX, y: padY + innerH - ((v - min) / range) * innerH }));
  const d = smoothPath(coords);
  const last = coords[coords.length - 1];
  const area = `${d} L${last.x.toFixed(1)},${h} L0,${h} Z`;
  const hitR = Math.max(4, Math.min(12, stepX / 2));

  const hovered = hoverIndex !== null ? points[hoverIndex] : null;
  const hoverX = hoverIndex !== null ? coords[hoverIndex].x : 0;
  const tooltipLeftPct = Math.max(18, Math.min(82, (hoverX / w) * 100));

  return (
    <div className="relative">
      <svg
        viewBox={`0 0 ${w} ${h}`}
        width="100%"
        height={h}
        preserveAspectRatio="none"
        className="block -mx-1 -mb-0.5"
        onMouseLeave={() => setHoverIndex(null)}
      >
        <defs>
          <linearGradient id={`kpitile-grad-${uid}`} x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor={color} stopOpacity="0.35" />
            <stop offset="100%" stopColor={color} stopOpacity="0" />
          </linearGradient>
        </defs>
        <line x1="0" x2={w} y1={h / 2} y2={h / 2} stroke="#24365a" strokeWidth="1" strokeDasharray="2 3" />
        <path d={area} fill={`url(#kpitile-grad-${uid})`} />
        <path d={d} fill="none" stroke={color} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
        {coords.map((c, i) => {
          const isLast = i === coords.length - 1;
          const isHover = i === hoverIndex;
          if (!isLast && !isHover) return null;
          return (
            <circle
              key={i}
              cx={c.x}
              cy={c.y}
              r={isHover ? 3.4 : 2.6}
              fill={color}
              opacity={isLast && !isHover ? 0.9 : 1}
              pointerEvents="none"
            />
          );
        })}
        {coords.map((c, i) => (
          <circle
            key={`hit-${i}`}
            cx={c.x}
            cy={c.y}
            r={hitR}
            fill="transparent"
            onMouseEnter={() => setHoverIndex(i)}
            style={{ cursor: "pointer" }}
          />
        ))}
      </svg>
      {hovered && (
        <div
          className="absolute bottom-full mb-1.5 -translate-x-1/2 whitespace-nowrap bg-bg border border-rule rounded px-2 py-1 text-[10px] font-mono text-ink shadow-lg pointer-events-none z-10"
          style={{ left: `${tooltipLeftPct}%` }}
        >
          {formatPeriod(hovered.week)}
          {formatIsoWeekRangeLabel(hovered.week) && ` · ${formatIsoWeekRangeLabel(hovered.week)}`}
          {" · "}
          <span className="text-teal">{formatValue(hovered.value)}</span>
        </div>
      )}
    </div>
  );
}

// formatWeekShort/formatMonthShort/fillRateStatus/returnRateStatus only exist
// client-side — these compose them with KpiTile so the server components
// (Dashboard.tsx, EmployeeHome.tsx) can pass raw trend data straight through
// without calling a client function during server render.
export function FillRateTile({ trend }: { trend: NonNullable<WeeklyTrend> }) {
  const latest = trend.points[trend.points.length - 1];
  return (
    <KpiTile
      kicker={`Fill Rate · ${trend.deptName}`}
      value={`${Math.round(latest.value)}%`}
      period={`${formatWeekShort(latest.week)} · última semana`}
      pill={fillRateStatus(latest.value)}
    >
      <MiniSparkline
        points={trend.points}
        color="#14C7C7"
        formatPeriod={formatWeekShort}
        formatValue={(v) => `${Math.round(v)}%`}
      />
    </KpiTile>
  );
}

export function ReturnRateTile({ trend }: { trend: NonNullable<WeeklyTrend> }) {
  const latest = trend.points[trend.points.length - 1];
  return (
    <KpiTile
      kicker={`Tasa de Devolución · ${trend.deptName}`}
      value={`${Math.round(latest.value)}%`}
      period={`${formatMonthShort(latest.week)} · último mes`}
      pill={returnRateStatus(latest.value)}
    >
      <MiniSparkline
        points={trend.points}
        color="#14C7C7"
        formatPeriod={formatMonthShort}
        formatValue={(v) => `${Math.round(v)}%`}
      />
    </KpiTile>
  );
}

export function WarrantyMonthTile({ chart, emptyMessage }: { chart: WarrantyMonthlyChart; emptyMessage: string }) {
  return (
    <KpiTile kicker="Garantías del mes" value={String(chart.total)} period={`${formatMonthShort(chart.month)} · ingresadas`}>
      <PieChart compact title="Garantías del mes" slices={chart.slices} emptyMessage={emptyMessage} />
    </KpiTile>
  );
}

