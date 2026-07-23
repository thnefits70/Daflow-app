"use client";

import { TrendingUp, TrendingDown } from "lucide-react";
import { KpiTile } from "./KpiTile";
import { formatMonthShort } from "./WeeklyTrendChart";
import type { StoreFeedbackAggregate } from "@/lib/storeFeedback";

// Public to everyone — confirmed 2026-07-22: the company-wide average is
// what's shown, never individual store detail (that stays Nairoby/admin-only
// inside "Servicio Postventa" in KPIs Generales).
export function StoreFeedbackTile({ data }: { data: StoreFeedbackAggregate }) {
  const trend = data.prevAvgLoyaltyScore != null ? Math.round((data.avgLoyaltyScore - data.prevAvgLoyaltyScore) * 10) / 10 : null;

  return (
    <KpiTile
      kicker="Servicio Postventa · Fidelización"
      value={`${data.avgLoyaltyScore.toFixed(1)}/10`}
      period={`${formatMonthShort(data.period)} · ${data.storeCount} tienda${data.storeCount === 1 ? "" : "s"} evaluada${data.storeCount === 1 ? "" : "s"}`}
    >
      {trend !== null && (
        <div className={`flex items-center gap-1 text-[11px] font-semibold ${trend >= 0 ? "text-green" : "text-red"}`}>
          {trend >= 0 ? <TrendingUp size={12} /> : <TrendingDown size={12} />}
          {trend >= 0 ? "+" : ""}
          {trend.toFixed(1)} vs. mes anterior
        </div>
      )}
    </KpiTile>
  );
}
