"use client";

import { useId } from "react";
import { smoothPath, formatWeekShort, formatMonthShort, fillRateStatus, returnRateStatus } from "./WeeklyTrendChart";
import { PieChart } from "./PieChart";
import type { WeeklyTrend, StockoutWeekPoint, WarrantyMonthlyChart } from "@/lib/dashboard";

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

export function MiniSparkline({ values, color }: { values: number[]; color: string }) {
  const uid = useId();
  const w = 220;
  const h = 40;
  const padY = 5;
  const max = Math.max(...values);
  const min = Math.min(...values);
  const range = max - min || 1;
  const innerH = h - padY * 2;
  const stepX = values.length > 1 ? w / (values.length - 1) : 0;
  const coords = values.map((v, i) => ({ x: i * stepX, y: padY + innerH - ((v - min) / range) * innerH }));
  const d = smoothPath(coords);
  const last = coords[coords.length - 1];
  const area = `${d} L${last.x.toFixed(1)},${h} L0,${h} Z`;

  return (
    <svg viewBox={`0 0 ${w} ${h}`} width="100%" height={h} preserveAspectRatio="none" className="block -mx-1 -mb-0.5">
      <defs>
        <linearGradient id={`kpitile-grad-${uid}`} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor={color} stopOpacity="0.35" />
          <stop offset="100%" stopColor={color} stopOpacity="0" />
        </linearGradient>
      </defs>
      <line x1="0" x2={w} y1={h / 2} y2={h / 2} stroke="#24365a" strokeWidth="1" strokeDasharray="2 3" />
      <path d={area} fill={`url(#kpitile-grad-${uid})`} />
      <path d={d} fill="none" stroke={color} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
      <circle cx={last.x} cy={last.y} r="4.5" fill={color} opacity="0.25" />
      <circle cx={last.x} cy={last.y} r="2.6" fill={color} />
    </svg>
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
      <MiniSparkline values={trend.points.map((p) => p.value)} color="#14C7C7" />
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
      <MiniSparkline values={trend.points.map((p) => p.value)} color="#14C7C7" />
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

export function StockoutTile({ points, className }: { points: StockoutWeekPoint[]; className?: string }) {
  const latest = points[points.length - 1];
  return (
    <KpiTile
      kicker="Ruptura de Stock · General"
      value={String(latest.value)}
      period={`${formatWeekShort(latest.week)} · productos distintos`}
      className={className}
    >
      <MiniBars values={points.slice(-7).map((p) => p.value)} color="#14C7C7" />
    </KpiTile>
  );
}

export function MiniBars({ values, color }: { values: number[]; color: string }) {
  const w = 220;
  const h = 40;
  const max = Math.max(...values) || 1;
  const gap = 5;
  const barW = (w - gap * (values.length - 1)) / values.length;

  return (
    <svg viewBox={`0 0 ${w} ${h}`} width="100%" height={h} preserveAspectRatio="none" className="block -mx-1 -mb-0.5">
      {values.map((v, i) => {
        const bh = Math.max(3, (v / max) * (h - 4));
        const x = i * (barW + gap);
        const y = h - bh;
        const isLast = i === values.length - 1;
        return <rect key={i} x={x} y={y} width={barW} height={bh} rx="2" fill={color} opacity={isLast ? 1 : 0.55} />;
      })}
    </svg>
  );
}
