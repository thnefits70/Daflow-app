"use client";

import { useEffect, useId, useState } from "react";
import {
  smoothPath,
  formatWeekShort,
  formatMonthShort,
  formatIsoWeekRangeLabel,
  fillRateStatus,
  returnRateStatus,
} from "./WeeklyTrendChart";
import { PieChart } from "./PieChart";
import { KpiInfoTip } from "@/components/shared/KpiInfoTip";
import type { WeeklyTrend, WarrantyMonthlyChart } from "@/lib/dashboard";
import type { TopReturnProducts } from "@/lib/returnRate";
import type { WarrantyLossMonth, WarrantyProductRow } from "@/lib/warrantyInsights";

// Confirmado 2026-08-31: pedido explícito del usuario — quien vea la
// tarjetita chiquita (no solo la tarjeta grande de desglose) debe poder
// ver a qué rango corresponde cada color, no solo el nombre de la banda
// actual ("Muy bueno") sin contexto de dónde empieza y termina.
export type KpiRangeLegendItem = { color: string; label: string };

export function KpiRangeLegend({ items }: { items: KpiRangeLegendItem[] }) {
  return (
    <div className="flex flex-wrap gap-x-2.5 gap-y-1 text-[9.5px] text-steel mt-2 pt-2 border-t border-dashed border-rule">
      {items.map((item) => (
        <span key={item.label} className="flex items-center gap-1">
          <span className="w-1.5 h-1.5 rounded-full shrink-0" style={{ background: item.color }} />
          {item.label}
        </span>
      ))}
    </div>
  );
}

export function KpiTile({
  kicker,
  value,
  period,
  pill,
  legend,
  className,
  children,
}: {
  kicker: string;
  value: string;
  period: string;
  pill?: { label: string; color: string };
  legend?: KpiRangeLegendItem[];
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
      {legend && <KpiRangeLegend items={legend} />}
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
// Splits a coordinate/value series into runs that are entirely inside vs.
// entirely past a danger threshold, interpolating the exact crossing point
// (in value-space, mapped back to screen x/y) so the color change lands
// precisely where the line actually crosses — not rounded to the nearest
// data point.
function splitDangerRuns(
  coords: { x: number; y: number }[],
  values: number[],
  isDanger: (v: number) => boolean,
  threshold: number
): { points: { x: number; y: number }[]; danger: boolean }[] {
  const runs: { points: { x: number; y: number }[]; danger: boolean }[] = [];
  let current: { x: number; y: number }[] = [coords[0]];
  let currentDanger = isDanger(values[0]);
  for (let i = 1; i < coords.length; i++) {
    const thisDanger = isDanger(values[i]);
    if (thisDanger === currentDanger) {
      current.push(coords[i]);
      continue;
    }
    const v0 = values[i - 1];
    const v1 = values[i];
    const t = (threshold - v0) / (v1 - v0);
    const crossing = { x: coords[i - 1].x + (coords[i].x - coords[i - 1].x) * t, y: coords[i - 1].y + (coords[i].y - coords[i - 1].y) * t };
    current.push(crossing);
    runs.push({ points: current, danger: currentDanger });
    current = [crossing, coords[i]];
    currentDanger = thisDanger;
  }
  runs.push({ points: current, danger: currentDanger });
  return runs;
}

export function MiniSparkline({
  points,
  color,
  dangerAbove,
  dangerBelow,
  dangerColor = "#E0574A",
  formatPeriod,
  formatValue,
}: {
  points: { week: string; value: number; detail?: string }[];
  color: string;
  // Confirmed 2026-07-22: only the portion of the line that actually
  // crosses this threshold turns red — everything inside range keeps the
  // normal brand color, not a whole-line status color. Use whichever
  // direction matches "worse" for this metric (Tasa de Devolución: above;
  // Fill Rate: below) — only one of the two should ever be passed.
  dangerAbove?: number;
  dangerBelow?: number;
  dangerColor?: string;
  formatPeriod: (period: string) => string;
  formatValue: (value: number) => string;
}) {
  const uid = useId();
  const [hoverIndex, setHoverIndex] = useState<number | null>(null);
  const [reducedMotion, setReducedMotion] = useState(false);
  useEffect(() => {
    const mq = window.matchMedia("(prefers-reduced-motion: reduce)");
    setReducedMotion(mq.matches);
  }, []);
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
  const dangerThreshold = dangerAbove ?? dangerBelow;
  const isDangerValue = (v: number) => (dangerAbove !== undefined ? v >= dangerAbove : dangerBelow !== undefined ? v < dangerBelow : false);
  const lastIsDanger = dangerThreshold !== undefined && isDangerValue(values[values.length - 1]);
  const dangerRuns =
    dangerThreshold !== undefined && coords.length > 1 ? splitDangerRuns(coords, values, isDangerValue, dangerThreshold) : null;

  // Traveling light dot, same technique as WeeklyTrendChart's — one
  // continuous <animateMotion> along the line so it never jumps, paired
  // with a calcMode="discrete" color step per segment. Here the color
  // reflects the danger zone (confirmed 2026-07-22) rather than rise/fall:
  // red while riding a segment that's past the threshold, normal color
  // otherwise.
  const segCount = coords.length - 1;
  const travelDur = Math.max(6, Math.min(16, segCount * 0.9));
  let travelDot: React.ReactNode = null;
  if (segCount > 0 && !reducedMotion) {
    const segColors = Array.from({ length: segCount }, (_, i) =>
      dangerThreshold !== undefined && (isDangerValue(values[i]) || isDangerValue(values[i + 1])) ? dangerColor : color
    );
    const keyTimes = segColors.map((_, i) => (i / segCount).toFixed(4)).join(";");
    travelDot = (
      <g color={color}>
        <animateMotion dur={`${travelDur}s`} repeatCount="indefinite" rotate="0" path={d} />
        <animate
          attributeName="color"
          dur={`${travelDur}s`}
          repeatCount="indefinite"
          calcMode="discrete"
          keyTimes={keyTimes}
          values={segColors.join(";")}
        />
        <circle r="6" fill="currentColor" opacity="0.3" filter={`url(#kpitile-glow-${uid})`} />
        <circle r="2.2" fill="currentColor" />
      </g>
    );
  }

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
          <filter id={`kpitile-glow-${uid}`} x="-200%" y="-200%" width="500%" height="500%">
            <feGaussianBlur stdDeviation="2.2" />
          </filter>
        </defs>
        <line x1="0" x2={w} y1={h / 2} y2={h / 2} stroke="var(--color-rule)" strokeWidth="1" strokeDasharray="2 3" />
        <path d={area} fill={`url(#kpitile-grad-${uid})`} />
        {dangerRuns ? (
          dangerRuns.map((run, i) => (
            <path
              key={i}
              d={smoothPath(run.points)}
              fill="none"
              stroke={run.danger ? dangerColor : color}
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
            />
          ))
        ) : (
          <path d={d} fill="none" stroke={color} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
        )}
        {travelDot}
        {coords.map((c, i) => {
          const isLast = i === coords.length - 1;
          const isHover = i === hoverIndex;
          if (!isLast && !isHover) return null;
          const dotColor = isLast && lastIsDanger ? dangerColor : color;
          return (
            <circle
              key={i}
              cx={c.x}
              cy={c.y}
              r={isHover ? 3.4 : 2.6}
              fill={dotColor}
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
          {hovered.detail && <span className="text-steel"> · {hovered.detail}</span>}
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
      legend={[
        { color: "#22C55E", label: "≥96% Excelente" },
        { color: "#D9A441", label: "90–95% Muy bueno" },
        { color: "#E0574A", label: "<90% Alerta" },
      ]}
    >
      <MiniSparkline
        points={trend.points}
        color="#14C7C7"
        dangerBelow={90}
        formatPeriod={formatWeekShort}
        formatValue={(v) => `${Math.round(v)}%`}
      />
    </KpiTile>
  );
}

// Pedido del usuario 2026-10-01: la misma tasa mensual, con botones para
// verla por marca. El desglose existe desde octubre 2026 (meses automáticos);
// lo de antes se copió de ATOM sin marca.
export function ReturnRateTile({ trend }: { trend: NonNullable<WeeklyTrend> }) {
  const [brand, setBrand] = useState<string | null>(null);
  const brandLabels = [...new Set(trend.points.flatMap((p) => (p.brands ?? []).map((b) => b.label)))];
  const series = brand
    ? trend.points.flatMap((p) => {
        const b = p.brands?.find((x) => x.label === brand);
        return b ? [{ week: p.week, value: b.value }] : [];
      })
    : trend.points;
  const latest = series[series.length - 1] ?? trend.points[trend.points.length - 1];
  const preliminary = !brand && !!trend.points[trend.points.length - 1]?.detail?.includes("preliminar");
  const chip = (active: boolean) =>
    `rounded-full border px-2 py-0.5 text-[10px] font-semibold cursor-pointer ${active ? "border-teal bg-teal/15 text-teal" : "border-rule text-steel"}`;
  return (
    <KpiTile
      kicker={`Tasa de Devolución · ${brand ?? trend.deptName}`}
      value={`${Math.round(latest.value)}%`}
      period={`${formatMonthShort(latest.week)} · último mes${preliminary ? " · preliminar" : ""}`}
      pill={returnRateStatus(latest.value)}
      legend={[
        { color: "#22C55E", label: "<20% Excelente" },
        { color: "#D9A441", label: "21–27% Muy bueno" },
        { color: "#E0574A", label: "≥28% Alerta" },
      ]}
    >
      {brandLabels.length > 0 && (
        <div className="flex flex-wrap gap-1 mb-2">
          <button type="button" className={chip(brand === null)} onClick={() => setBrand(null)}>
            General
          </button>
          {brandLabels.map((b) => (
            <button key={b} type="button" className={chip(brand === b)} onClick={() => setBrand(b)}>
              {b}
            </button>
          ))}
        </div>
      )}
      <MiniSparkline
        points={series}
        color="#14C7C7"
        dangerAbove={28}
        formatPeriod={formatMonthShort}
        formatValue={(v) => `${Math.round(v)}%`}
      />
    </KpiTile>
  );
}

// Pedido del usuario 2026-10-01: en Inicio, junto a la tasa, los productos
// que más regresan en los últimos 30 días (ver getTopReturnProducts).
export function ReturnProductsTile({ data, href }: { data: TopReturnProducts; href?: string }) {
  return (
    <div className="bg-surface border border-rule rounded-lg p-4">
      <div className="font-mono text-[9.5px] font-semibold uppercase tracking-wide text-steel mb-2">Productos que más regresan</div>
      <div className="flex items-baseline gap-2 flex-wrap mb-0.5">
        <span className="font-display text-[22px] font-bold leading-none">{data.highCount}</span>
        <span className="text-[11px] text-steel">con 15% o más de devolución</span>
      </div>
      <div className="text-[10.5px] text-steel mb-2.5">Últimos 30 días · por unidades</div>
      {data.readyAt ? (
        <div className="text-[11.5px] text-steel">
          Empieza a mostrarse el {new Date(data.readyAt).toLocaleDateString("es-EC", { day: "numeric", month: "long", timeZone: "America/Guayaquil" })}, cuando ya hayan regresado las devoluciones de los primeros cortes.
        </div>
      ) : data.rows.length === 0 ? (
        <div className="text-[11.5px] text-steel">Todavía no hay productos con suficientes salidas.</div>
      ) : (
        <div className="flex flex-col divide-y divide-rule">
          {data.rows.map((r) => (
            <div key={r.key} className="flex items-center justify-between gap-2 py-1.5 text-[12px]">
              <span className="min-w-0 truncate">{r.name}</span>
              <span className="shrink-0 text-steel">
                {r.returned}/{r.out} ·{" "}
                <b className={r.high ? "text-red" : "text-ink"}>{r.pct}%</b>
              </span>
            </div>
          ))}
        </div>
      )}
      {href && (
        <a href={href} className="inline-block mt-2 text-[11px] font-semibold text-blue">
          Ver todos →
        </a>
      )}
    </div>
  );
}

export function WarrantyMonthTile({ chart, emptyMessage }: { chart: WarrantyMonthlyChart; emptyMessage: string }) {
  // Pedido del usuario 2026-10-03: cantidad + % de los pedidos sin decimales,
  // y si mejoró o empeoró contra el mes anterior (menos es mejor).
  const rate = chart.rate;
  const prev = chart.prevRatePct;
  return (
    <KpiTile kicker="Garantías del mes" value={String(chart.total)} period={`${formatMonthShort(chart.month)} · ingresadas`}>
      {rate && (
        <div className="text-[11px] text-steel mb-2 -mt-1.5">
          <b className="text-ink">{rate.ratePct === 0 && chart.total > 0 ? "menos de 1%" : `${rate.ratePct}%`}</b> de los pedidos ({rate.orders.toLocaleString("es-EC")} pedidos)
          {prev != null && prev !== rate.ratePct && (
            <span className={`ml-1 font-semibold ${rate.ratePct < prev ? "text-teal" : "text-red"}`}>
              {rate.ratePct < prev ? "↓ mejoró" : "↑ empeoró"} (antes {prev}%)
            </span>
          )}
          {prev != null && prev === rate.ratePct && <span className="ml-1">· igual que el mes anterior</span>}
        </div>
      )}
      <PieChart compact title="Garantías del mes" slices={chart.slices} emptyMessage={emptyMessage} />
    </KpiTile>
  );
}

// Pedido del usuario 2026-10-03: productos con más garantías (últimos 30
// días, cortes + locales), ordenados por fallas del producto — para saber
// cuál reclamar al proveedor o dejar de comprar.
export function WarrantyProductsTile({ rows }: { rows: WarrantyProductRow[] }) {
  return (
    <div className="bg-surface border border-rule rounded-lg p-4">
      <div className="font-mono text-[9.5px] font-semibold uppercase tracking-wide text-steel mb-2">Productos con más garantías</div>
      <div className="text-[10.5px] text-steel mb-2.5">Últimos 30 días · ordenados por fallas del producto</div>
      {rows.length === 0 ? (
        <div className="text-[11.5px] text-steel">No hubo garantías en los últimos 30 días.</div>
      ) : (
        <div className="flex flex-col divide-y divide-rule">
          {rows.map((r) => (
            <div key={r.catalogItemId} className="flex items-center justify-between gap-2 py-1.5 text-[12px]">
              <span className="min-w-0 truncate">{r.name}</span>
              <span className="shrink-0 text-steel text-[11px]">
                <b className={r.product > 0 ? "text-red" : "text-ink"}>{r.product}</b> falla{r.product === 1 ? "" : "s"}
                {r.pct != null && r.product > 0 && <> ({r.pct === 0 ? "menos de 1%" : `${r.pct}%`} de {r.out} vendidas)</>}
                {r.bodega > 0 && <> · {r.bodega} de bodega</>}
              </span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function usd(n: number) {
  return `${n.toLocaleString("es-EC", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

// Pedido del usuario 2026-10-03: pérdidas por garantías en ROJO para que
// quien lo vea se alerte. TODO el equipo ve el total en dólares; el detalle
// producto/fletes solo llega para admin y Nairoby (productCost/freight null
// para el resto, ver getWarrantyLossOverview). El 6% nunca sale en Inicio.
export function WarrantyCostTile({ current, previous }: { current: WarrantyLossMonth; previous: WarrantyLossMonth | null }) {
  const detail = current.productCost != null && current.freight != null;
  return (
    <div className="bg-surface border border-rule rounded-lg p-4">
      <div className="flex items-center gap-1.5 flex-wrap mb-2">
        <span className="font-mono text-[9.5px] font-semibold uppercase tracking-wide text-steel">Pérdidas por garantías</span>
        <KpiInfoTip>
          <b className="text-ink">Cuánto dinero se perdió este mes por garantías.</b> Cuando un cliente recibe un producto dañado, roto, incompleto o equivocado, hay que mandarle otro nuevo de bodega y pagar el flete de enviar y de recoger. Esa plata no regresa: cada garantía que se evita es dinero que se queda en la empresa. Se actualiza solo cada vez que se registra una garantía nueva.
        </KpiInfoTip>
      </div>
      <div className="flex items-baseline gap-2 flex-wrap mb-0.5">
        <span className={`font-display text-[22px] font-bold leading-none ${current.total > 0 ? "text-red" : ""}`}>{usd(current.total)}</span>
        <span className="text-[11px] text-steel">perdidos este mes</span>
      </div>
      <div className="text-[10.5px] text-steel">{formatMonthShort(current.month)} · {current.warranties} garantía{current.warranties === 1 ? "" : "s"}</div>
      {detail && (
        <div className="text-[11.5px] flex flex-col gap-0.5 mt-2.5">
          <div className="flex justify-between"><span className="text-steel">Producto reemplazado</span><span>{usd(current.productCost!)}</span></div>
          <div className="flex justify-between"><span className="text-steel">Fletes (promedio $6)</span><span>{usd(current.freight!)}</span></div>
          <div className={`flex justify-between font-semibold ${current.total > 0 ? "text-red" : "text-ink"}`}>
            <span>Total en pérdidas</span>
            <span>{usd(current.total)}</span>
          </div>
        </div>
      )}
      {previous && (
        <div className="text-[10.5px] text-steel mt-2 pt-2 border-t border-dashed border-rule">
          Mes anterior ({formatMonthShort(previous.month)}): {usd(previous.total)} en pérdidas
        </div>
      )}
    </div>
  );
}

