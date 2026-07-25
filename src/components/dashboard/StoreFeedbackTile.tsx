"use client";

import { useEffect, useState } from "react";
import { TrendingUp, TrendingDown } from "lucide-react";
import { KpiTile } from "./KpiTile";
import { formatMonthShort, smoothPath } from "./WeeklyTrendChart";
import type { StoreFeedbackAggregate, StoreFeedbackTrendPoint } from "@/lib/storeFeedback";
import { trendStateFor } from "@/lib/storeFeedbackCalc";

// Public to everyone — confirmed 2026-07-22: the company-wide average is
// what's shown, never individual store detail (that stays admin/Análisis de
// Mercado-only inside la pestaña "Servicio Postventa").
export function StoreFeedbackTile({
  data,
  trend,
}: {
  data: StoreFeedbackAggregate;
  trend: StoreFeedbackTrendPoint[];
}) {
  const [reducedMotion, setReducedMotion] = useState(false);
  useEffect(() => {
    setReducedMotion(window.matchMedia("(prefers-reduced-motion: reduce)").matches);
  }, []);

  const trendDelta = data.prevAvgLoyaltyScore != null ? Math.round((data.avgLoyaltyScore - data.prevAvgLoyaltyScore) * 10) / 10 : null;
  const state = trendStateFor(data.avgLoyaltyScore);

  const width = 300;
  const height = 54;
  const padX = 6;
  const padTop = 6;
  const padBottom = 6;
  const innerW = width - padX * 2;
  const innerH = height - padTop - padBottom;
  const yMax = 5;

  const points = trend.length > 0 ? trend : [{ period: data.period, avgLoyaltyScore: data.avgLoyaltyScore }];
  const stepX = points.length > 1 ? innerW / (points.length - 1) : 0;
  const coords = points.map((p, i) => ({
    x: padX + (points.length > 1 ? i * stepX : innerW / 2),
    y: padTop + innerH - (p.avgLoyaltyScore / yMax) * innerH,
  }));
  const linePath = smoothPath(coords);
  const last = coords[coords.length - 1];
  const areaPath = `${linePath} L${last.x.toFixed(1)},${(padTop + innerH).toFixed(1)} L${coords[0].x.toFixed(1)},${(padTop + innerH).toFixed(1)} Z`;

  const showTravelDot = state.hot && coords.length > 1 && !reducedMotion;
  const travelDur = Math.max(3, Math.min(6, coords.length * 0.8));

  return (
    <KpiTile
      kicker="Servicio Postventa · Fidelización"
      value={`${data.avgLoyaltyScore.toFixed(1)}/5`}
      period={`${formatMonthShort(data.period)} · ${data.storeCount} tienda${data.storeCount === 1 ? "" : "s"} evaluada${data.storeCount === 1 ? "" : "s"}`}
    >
      {trendDelta !== null && (
        <div className={`flex items-center gap-1 text-[11px] font-semibold mb-2 ${trendDelta >= 0 ? "text-green" : "text-red"}`}>
          {trendDelta >= 0 ? <TrendingUp size={12} /> : <TrendingDown size={12} />}
          {trendDelta >= 0 ? "+" : ""}
          {trendDelta.toFixed(1)} vs. mes anterior
        </div>
      )}
      {coords.length > 1 && (
        <div>
          <svg viewBox={`0 0 ${width} ${height}`} width="100%" height={height} preserveAspectRatio="none" style={{ overflow: "visible", display: "block" }}>
            <defs>
              <linearGradient id="store-feedback-fill" x1="0" y1="0" x2="0" y2="1">
                <stop offset="0%" stopColor={state.color} stopOpacity="0.32" />
                <stop offset="100%" stopColor={state.color} stopOpacity="0" />
              </linearGradient>
              <filter id="store-feedback-dot-glow" x="-200%" y="-200%" width="500%" height="500%">
                <feGaussianBlur stdDeviation="3.5" />
              </filter>
            </defs>
            <path d={areaPath} fill="url(#store-feedback-fill)" />
            <path d={linePath} fill="none" stroke={state.color} strokeWidth="2.25" strokeLinejoin="round" strokeLinecap="round" />
            <circle cx={last.x} cy={last.y} r="4" fill={state.color} />
            {showTravelDot && (
              <g color={state.color}>
                <animateMotion dur={`${travelDur}s`} repeatCount="indefinite" rotate="0" path={linePath} />
                <circle r="8" fill="currentColor" opacity="0.3" filter="url(#store-feedback-dot-glow)" />
                <circle r="3" fill="currentColor" />
              </g>
            )}
          </svg>
          <div className="flex justify-between font-mono text-[9.5px] text-steel mt-1">
            {points.map((p) => (
              <span key={p.period}>{formatMonthShort(p.period).slice(0, 3)}</span>
            ))}
          </div>
        </div>
      )}
    </KpiTile>
  );
}
