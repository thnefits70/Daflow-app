"use client";

import { useEffect, useRef, useState } from "react";

export type WeeklyPoint = { week: string; value: number; detail?: string };

export function formatWeekShort(week: string) {
  const [, w] = week.split("-W");
  return `S${Number(w)}`;
}

const MONTH_ABBR = ["Ene", "Feb", "Mar", "Abr", "May", "Jun", "Jul", "Ago", "Sep", "Oct", "Nov", "Dic"];

export function formatMonthShort(month: string) {
  const [y, m] = month.split("-");
  return `${MONTH_ABBR[Number(m) - 1]} ${y.slice(2)}`;
}

// ISO-8601 week ("YYYY-Www") -> the Monday..Sunday calendar range it covers,
// so a chart can answer "which actual dates is S28?" on click. Returns null
// for anything that isn't week-shaped (e.g. a "YYYY-MM" month string), so
// callers can use it to gate whether a period label is click-worthy at all.
export function isoWeekDateRange(week: string): { start: Date; end: Date } | null {
  const match = /^(\d{4})-W(\d{1,2})$/.exec(week);
  if (!match) return null;
  const year = Number(match[1]);
  const weekNum = Number(match[2]);
  const simple = new Date(Date.UTC(year, 0, 1 + (weekNum - 1) * 7));
  const dayOfWeek = simple.getUTCDay() || 7;
  const monday = new Date(simple);
  monday.setUTCDate(simple.getUTCDate() + (dayOfWeek <= 4 ? 1 - dayOfWeek : 8 - dayOfWeek));
  const sunday = new Date(monday);
  sunday.setUTCDate(monday.getUTCDate() + 6);
  return { start: monday, end: sunday };
}

export function formatIsoWeekRangeLabel(week: string): string | null {
  const range = isoWeekDateRange(week);
  if (!range) return null;
  const fmt = (d: Date) => `${d.getUTCDate()} ${MONTH_ABBR[d.getUTCMonth()]}`;
  const year = range.end.getUTCFullYear();
  return `${fmt(range.start)} – ${fmt(range.end)} ${year}`;
}

function goalStatus(pct: number) {
  if (pct >= 100) return { label: "Excelente", color: "#14C7C7" };
  if (pct >= 80) return { label: "Eficiente", color: "#1E5EFF" };
  return { label: "No eficiente", color: "#C4453A" };
}

// Fill Rate reads on a much tighter band than a units goal like Pedidos
// despachados — only above 99% counts as efficient.
function fillRateStatus(pct: number) {
  if (pct > 99) return { label: "Eficiente", color: "#14C7C7" };
  if (pct >= 98) return { label: "Regular", color: "#D9A441" };
  return { label: "Ineficiente", color: "#C4453A" };
}

// Inverse of the other two metrics — lower is better. Under 20% is the
// acceptable ceiling; it gets worse the higher it climbs from there.
export function returnRateStatus(pct: number) {
  if (pct < 20) return { label: "Eficiente", color: "#14C7C7" };
  if (pct < 30) return { label: "Regular", color: "#D9A441" };
  return { label: "Ineficiente", color: "#C4453A" };
}

function niceMax(value: number) {
  if (value <= 0) return 10;
  const magnitude = Math.pow(10, Math.floor(Math.log10(value)));
  const normalized = value / magnitude;
  const niceNormalized = normalized <= 1 ? 1 : normalized <= 2 ? 2 : normalized <= 5 ? 5 : 10;
  return niceNormalized * magnitude;
}

export function smoothPath(coords: { x: number; y: number }[]) {
  if (coords.length === 0) return "";
  if (coords.length === 1) return `M${coords[0].x},${coords[0].y}`;
  let d = `M${coords[0].x.toFixed(1)},${coords[0].y.toFixed(1)}`;
  for (let i = 0; i < coords.length - 1; i++) {
    const p0 = coords[i - 1] ?? coords[i];
    const p1 = coords[i];
    const p2 = coords[i + 1];
    const p3 = coords[i + 2] ?? p2;
    const cp1x = p1.x + (p2.x - p0.x) / 6;
    const cp1y = p1.y + (p2.y - p0.y) / 6;
    const cp2x = p2.x - (p3.x - p1.x) / 6;
    const cp2y = p2.y - (p3.y - p1.y) / 6;
    d += ` C${cp1x.toFixed(1)},${cp1y.toFixed(1)} ${cp2x.toFixed(1)},${cp2y.toFixed(1)} ${p2.x.toFixed(1)},${p2.y.toFixed(1)}`;
  }
  return d;
}

export function WeeklyTrendChart({
  label,
  deptName,
  points,
  weeklyGoal,
  format = "count",
  periodLabel = formatWeekShort,
  latestLabel = "última semana",
  statusFn,
}: {
  label: string;
  deptName: string;
  points: WeeklyPoint[];
  weeklyGoal?: number;
  format?: "count" | "percent";
  periodLabel?: (period: string) => string;
  latestLabel?: string;
  statusFn?: (value: number) => { label: string; color: string };
}) {
  const [hoverIndex, setHoverIndex] = useState<number | null>(null);
  const [dateTooltipWeek, setDateTooltipWeek] = useState<string | null>(null);
  const rootRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    function onClickOutside(e: MouseEvent) {
      if (rootRef.current && !rootRef.current.contains(e.target as Node)) setDateTooltipWeek(null);
    }
    document.addEventListener("mousedown", onClickOutside);
    return () => document.removeEventListener("mousedown", onClickOutside);
  }, []);

  if (points.length === 0) return null;

  const fmt = (v: number) => (format === "percent" ? `${Math.round(v)}%` : v.toLocaleString("es-MX"));

  const latest = points[points.length - 1];
  const width = 1000;
  const height = 300;
  const padL = 52;
  const padR = 20;
  const padT = 16;
  const padB = 30;
  const innerW = width - padL - padR;
  const innerH = height - padT - padB;

  const rawMax = Math.max(...points.map((p) => p.value), 0);
  const yMax =
    weeklyGoal && rawMax <= weeklyGoal ? weeklyGoal : niceMax(Math.max(rawMax, weeklyGoal ?? 0) * 1.08);
  const yTicks = 4;

  const stepX = points.length > 1 ? innerW / (points.length - 1) : 0;
  const coords = points.map((p, i) => ({
    x: padL + (points.length > 1 ? i * stepX : innerW / 2),
    y: padT + innerH - (p.value / yMax) * innerH,
  }));

  const linePath = smoothPath(coords);
  const last = coords[coords.length - 1];
  const areaPath = `${linePath} L${last.x.toFixed(1)},${(padT + innerH).toFixed(1)} L${coords[0].x.toFixed(1)},${(padT + innerH).toFixed(1)} Z`;

  const goalPct = weeklyGoal ? Math.round((latest.value / weeklyGoal) * 100) : null;
  const status = statusFn
    ? statusFn(latest.value)
    : goalPct !== null
    ? (format === "percent" ? fillRateStatus(goalPct) : goalStatus(goalPct))
    : null;
  const goalYRaw = weeklyGoal ? padT + innerH - (weeklyGoal / yMax) * innerH : null;
  const goalY = goalYRaw !== null && goalYRaw > padT + 4 ? goalYRaw : null;

  const tickEvery = Math.max(1, Math.ceil(points.length / 12));
  const hitR = Math.max(4, Math.min(14, stepX / 2 - 1));

  return (
    <div ref={rootRef}>
      <div className="flex items-start justify-between flex-wrap gap-4 mb-5">
        <div>
          <div className="text-[11px] font-semibold tracking-wide uppercase text-steel mb-1.5">
            {label} · {deptName}
          </div>
          <div className="flex items-baseline gap-2.5 flex-wrap">
            <span className="font-display text-[32px] font-bold text-ink leading-none">{fmt(latest.value)}</span>
            <span
              className={`text-[12px] text-steel ${isoWeekDateRange(latest.week) ? "cursor-pointer hover:underline" : ""}`}
              onClick={() => isoWeekDateRange(latest.week) && setDateTooltipWeek((v) => (v === latest.week ? null : latest.week))}
            >
              {periodLabel(latest.week)} ({latestLabel})
            </span>
            {dateTooltipWeek === latest.week && (
              <span className="text-[11px] text-teal font-mono">{formatIsoWeekRangeLabel(latest.week)}</span>
            )}
          </div>
        </div>
        {status && (
          <div className="flex items-center gap-2.5">
            <span
              className="font-mono text-[10.5px] font-semibold tracking-wider px-2.5 py-1 rounded-full"
              style={{ color: status.color, border: `1px solid ${status.color}`, background: `${status.color}1a` }}
            >
              {status.label}
            </span>
            {format !== "percent" && goalPct !== null && (
              <span className="text-[12px] text-steel">
                {goalPct}% de la meta semanal ({weeklyGoal!.toLocaleString("es-MX")})
              </span>
            )}
          </div>
        )}
      </div>

      <svg
        viewBox={`0 0 ${width} ${height}`}
        width="100%"
        height={height}
        preserveAspectRatio="none"
        className="block"
        onMouseLeave={() => setHoverIndex(null)}
      >
        <defs>
          <linearGradient id="weekly-trend-fill" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="#14C7C7" stopOpacity="0.32" />
            <stop offset="100%" stopColor="#14C7C7" stopOpacity="0" />
          </linearGradient>
        </defs>

        {Array.from({ length: yTicks + 1 }).map((_, i) => {
          const v = (yMax / yTicks) * i;
          const y = padT + innerH - (v / yMax) * innerH;
          return (
            <g key={i}>
              <line x1={padL} x2={width - padR} y1={y} y2={y} stroke="#24365a" strokeWidth="1" />
              <text x={padL - 10} y={y + 3} textAnchor="end" fontSize="11" fill="#92a3c0">
                {fmt(v)}
              </text>
            </g>
          );
        })}

        {goalY !== null && (
          <>
            <line x1={padL} x2={width - padR} y1={goalY} y2={goalY} stroke="#C4453A" strokeWidth="1.25" strokeDasharray="5 4" opacity="0.75" />
            <text x={width - padR} y={goalY - 6} textAnchor="end" fontSize="10.5" fill="#C4453A">
              Meta {fmt(weeklyGoal!)}
            </text>
          </>
        )}

        {coords.map((c, i) =>
          i % tickEvery === 0 || i === coords.length - 1 ? (
            <text
              key={i}
              x={c.x}
              y={height - 8}
              textAnchor="middle"
              fontSize="10.5"
              fill={dateTooltipWeek === points[i].week ? "#14C7C7" : "#92a3c0"}
              style={isoWeekDateRange(points[i].week) ? { cursor: "pointer" } : undefined}
              onClick={() =>
                isoWeekDateRange(points[i].week) &&
                setDateTooltipWeek((v) => (v === points[i].week ? null : points[i].week))
              }
            >
              {periodLabel(points[i].week)}
            </text>
          ) : null
        )}

        <path d={areaPath} fill="url(#weekly-trend-fill)" />
        <path d={linePath} fill="none" stroke="#14C7C7" strokeWidth="2.25" strokeLinejoin="round" strokeLinecap="round" />

        {hoverIndex !== null && (
          <line
            x1={coords[hoverIndex].x}
            x2={coords[hoverIndex].x}
            y1={padT}
            y2={padT + innerH}
            stroke="#92A3C0"
            strokeWidth="1"
            strokeDasharray="3 3"
            opacity="0.5"
            pointerEvents="none"
          />
        )}

        {coords.map((c, i) => {
          const isLast = i === coords.length - 1;
          const isHover = i === hoverIndex;
          return (
            <circle
              key={i}
              cx={c.x}
              cy={c.y}
              r={isHover ? 5 : isLast ? 4 : 2}
              fill={isHover || isLast ? "#14C7C7" : "#0a1526"}
              stroke={isHover ? "#0a1526" : isLast ? "none" : "#14C7C7"}
              strokeWidth={isHover ? 2 : isLast ? 0 : 1.5}
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

        {hoverIndex !== null &&
          (() => {
            const c = coords[hoverIndex];
            const p = points[hoverIndex];
            const boxW = p.detail ? 172 : 128;
            const boxH = p.detail ? 58 : 42;
            const boxX = Math.max(padL, Math.min(c.x - boxW / 2, width - padR - boxW));
            const boxY = Math.max(4, c.y - boxH - 12);
            return (
              <g pointerEvents="none">
                <rect x={boxX} y={boxY} width={boxW} height={boxH} rx="6" fill="#101f3b" stroke="#24365a" strokeWidth="1" />
                <text x={boxX + boxW / 2} y={boxY + 17} textAnchor="middle" fontSize="10.5" fill="#92a3c0">
                  {periodLabel(p.week)}
                </text>
                <text x={boxX + boxW / 2} y={boxY + 33} textAnchor="middle" fontSize="14" fontWeight="700" fill="#f1f5fb">
                  {fmt(p.value)}{format !== "percent" && " pedidos"}
                </text>
                {p.detail && (
                  <text x={boxX + boxW / 2} y={boxY + 49} textAnchor="middle" fontSize="10.5" fill="#92a3c0">
                    {p.detail}
                  </text>
                )}
              </g>
            );
          })()}

        {dateTooltipWeek !== null &&
          (() => {
            const idx = points.findIndex((p) => p.week === dateTooltipWeek);
            const rangeLabel = formatIsoWeekRangeLabel(dateTooltipWeek);
            if (idx === -1 || !rangeLabel) return null;
            const c = coords[idx];
            const boxW = Math.max(110, rangeLabel.length * 6.2 + 20);
            const boxX = Math.max(padL, Math.min(c.x - boxW / 2, width - padR - boxW));
            return (
              <g pointerEvents="none">
                <rect x={boxX} y={height - 52} width={boxW} height={20} rx="5" fill="#101f3b" stroke="#14C7C7" strokeWidth="1" />
                <text x={boxX + boxW / 2} y={height - 38} textAnchor="middle" fontSize="10.5" fill="#f1f5fb">
                  {rangeLabel}
                </text>
              </g>
            );
          })()}
      </svg>
    </div>
  );
}
