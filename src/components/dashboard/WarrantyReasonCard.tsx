"use client";

import { useState } from "react";
import { ChevronRight, ChevronLeft } from "lucide-react";
import { KpiTile } from "./KpiTile";
import { PieChart } from "./PieChart";
import { WarrantyReasonTrendChart } from "./WarrantyReasonTrendChart";
import type { PieSlice, WarrantyReasonTrendSeries } from "@/lib/dashboard";

// Toggles the "Motivos que más se repiten" tile between its usual pie
// (this-12-months snapshot) and a full-width trend view (each motivo's
// month-by-month line) — same grid cell, so it needs its own client
// component to hold the expand/collapse state and grow to sm:col-span-2
// only while expanded (matches the FillRateBreakdownCard/StockoutBarChart
// pattern of the full-width cards already in this grid).
export function WarrantyReasonCard({ slices, trend }: { slices: PieSlice[]; trend: WarrantyReasonTrendSeries[] }) {
  const [expanded, setExpanded] = useState(false);
  const total = slices.reduce((a, s) => a + s.value, 0);

  // Reorders trend series to match the pie's slice order (already sorted by
  // total value in getWarrantyReasonChart) so each motivo gets the exact
  // same PALETTE color in both views.
  const orderedTrend = slices
    .map((s) => trend.find((t) => t.label === s.label))
    .filter((t): t is WarrantyReasonTrendSeries => t !== undefined);
  const canShowTrend = orderedTrend.length > 0 && orderedTrend[0].points.length >= 2;

  if (expanded) {
    return (
      <div className="sm:col-span-2 bg-surface border border-rule rounded-lg p-4">
        <div className="flex items-center justify-between gap-3 flex-wrap mb-3">
          <div>
            <div className="font-mono text-[9.5px] font-semibold uppercase tracking-wide text-steel mb-1">
              Motivos que más se repiten
            </div>
            <div className="text-[10.5px] text-steel">Tendencia mensual · % del total de garantías de cada mes</div>
          </div>
          <button
            type="button"
            className="inline-flex items-center gap-1 text-[11.5px] font-semibold text-blue cursor-pointer shrink-0"
            onClick={() => setExpanded(false)}
          >
            <ChevronLeft size={13} /> Ver este mes
          </button>
        </div>
        <WarrantyReasonTrendChart series={orderedTrend} />
      </div>
    );
  }

  return (
    <KpiTile kicker="Motivos que más se repiten" value={String(total)} period="Últimos 12 meses">
      <PieChart compact title="Motivos que más se repiten" slices={slices} emptyMessage="Aún no hay suficiente historial." />
      {canShowTrend && (
        <button
          type="button"
          className="inline-flex items-center gap-1 text-[10.5px] font-semibold text-blue cursor-pointer mt-2.5"
          onClick={() => setExpanded(true)}
        >
          Ver tendencia por mes <ChevronRight size={12} />
        </button>
      )}
    </KpiTile>
  );
}
