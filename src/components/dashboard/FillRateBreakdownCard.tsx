import { formatWeekShort } from "./WeeklyTrendChart";
import type { FillRateBreakdown } from "@/lib/dashboard";

const STATUS_META: Record<NonNullable<FillRateBreakdown>["status"], { label: string; color: string }> = {
  good: { label: "Eficiente", color: "#22C55E" },
  regular: { label: "Regular", color: "#D9A441" },
  crit: { label: "Alerta", color: "#E0574A" },
};

function pct(n: number, total: number) {
  return total === 0 ? 0 : Math.round((n / total) * 1000) / 10;
}

// Confirmado 2026-07-28 (boceto aprobado): desglose de la ÚLTIMA semana con
// datos, en 4 etapas — complementa, no reemplaza, la tarjetita chiquita de
// tendencia que ya existe arriba. Va posicionada arriba de Ruptura de Stock
// tanto en Dashboard (admin) como en EmployeeHome (líder de Fulfillment).
export function FillRateBreakdownCard({ data }: { data: NonNullable<FillRateBreakdown> }) {
  const status = STATUS_META[data.status];
  const segs = [
    { label: "Despachadas", value: data.dispatched, color: "#14C7C7" },
    { label: "Preparadas", value: data.prepared, color: "#1E5EFF" },
    { label: "Generadas", value: data.generated, color: "#D9A441" },
    { label: "Falta de stock", value: data.outOfStock, color: "#E0574A" },
  ];

  return (
    <div className="bg-surface border border-rule rounded-lg p-6 mb-5">
      <div className="flex items-end justify-between flex-wrap gap-2 mb-4">
        <div>
          <div className="font-mono text-[10.5px] uppercase tracking-wide text-steel mb-1">
            Fill Rate · {data.deptName} · {formatWeekShort(data.week)} · última semana
          </div>
          <div className="font-display text-[34px] font-bold leading-none">{data.fillRatePct}%</div>
        </div>
        <span
          className="font-mono text-[11px] font-bold tracking-wide px-3 py-1 rounded-full"
          style={{ color: status.color, border: `1px solid ${status.color}`, background: `${status.color}22` }}
        >
          {status.label}
        </span>
      </div>

      <div className="flex h-8 rounded-md overflow-hidden mb-3.5">
        {segs.map((s) => {
          const w = pct(s.value, data.total);
          return (
            <div
              key={s.label}
              style={{ width: `${w}%`, background: s.color }}
              className="flex items-center justify-center text-[11px] font-bold text-navy"
            >
              {w > 8 ? `${Math.round(w)}%` : ""}
            </div>
          );
        })}
      </div>

      <div className="grid grid-cols-2 sm:grid-cols-4 gap-2.5 mb-4">
        {segs.map((s) => (
          <div key={s.label} className="bg-cloud border border-rule rounded-md px-3 py-2.5">
            <div className="flex items-center gap-1.5 text-[11px] text-steel mb-0.5">
              <span className="w-2 h-2 rounded-sm shrink-0" style={{ background: s.color }} />
              {s.label}
            </div>
            <div className="font-display text-[18px] font-bold">
              {s.value.toLocaleString("es-MX")}
              <span className="text-[11px] text-steel font-normal ml-1">{pct(s.value, data.total)}%</span>
            </div>
          </div>
        ))}
      </div>

      <div className="flex flex-wrap gap-2 text-[11px] text-steel">
        <span className="flex items-center gap-1.5"><span className="w-2 h-2 rounded-full" style={{ background: "#22C55E" }} />≥98% Eficiente</span>
        <span className="flex items-center gap-1.5"><span className="w-2 h-2 rounded-full" style={{ background: "#D9A441" }} />95–97% Regular</span>
        <span className="flex items-center gap-1.5"><span className="w-2 h-2 rounded-full" style={{ background: "#E0574A" }} />&lt;95% Alerta</span>
      </div>
    </div>
  );
}
