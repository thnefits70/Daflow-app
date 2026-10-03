import { KpiInfoTip } from "@/components/shared/KpiInfoTip";
import { formatMonthShort } from "@/components/dashboard/WeeklyTrendChart";
import type { LossCoverageMonth } from "@/lib/lossCoverage";

const usd = (n: number) => `$${n.toLocaleString("es-EC", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

// Pedido del usuario 2026-10-03: ¿alcanza el 6% de seguro que lleva cada
// precio de Dropi para cubrir TODAS las pérdidas de mercadería? Solo admin y
// Nairoby (la data ni llega para nadie más, ver financeKpis.ts).
function MonthCard({ m }: { m: LossCoverageMonth }) {
  const covered = m.total <= m.reserve;
  const diff = Math.abs(m.reserve - m.total);
  const usedPct = m.reserve > 0 ? Math.min(100, (m.total / m.reserve) * 100) : m.total > 0 ? 100 : 0;
  const rows = [
    { label: "Garantías", hint: `${m.warranty.count} garantía${m.warranty.count === 1 ? "" : "s"} · producto ${usd(m.warranty.productCost)} + fletes ${usd(m.warranty.freight)}`, total: m.warranty.total },
    { label: "Deterioro dado de baja", hint: `${m.deterioro.units} unidad${m.deterioro.units === 1 ? "" : "es"} encontradas dañadas en bodega`, total: m.deterioro.total },
    { label: "Reclamos rechazados por el proveedor", hint: `${m.supplierRejected.units} unidad${m.supplierRejected.units === 1 ? "" : "es"} · no cambió ni dio crédito`, total: m.supplierRejected.total },
    { label: "Devoluciones dañadas sin arreglo", hint: `${m.damagedReturns.units} unidad${m.damagedReturns.units === 1 ? "" : "es"} que regresaron rotas`, total: m.damagedReturns.total },
  ];
  return (
    <div className="bg-surface border border-rule rounded-lg p-4">
      <div className="flex items-baseline justify-between gap-3 flex-wrap mb-3">
        <div>
          <div className="text-[10.5px] text-steel mb-1">Pérdidas de {formatMonthShort(m.month)}</div>
          <div className="font-display text-[26px] font-bold leading-none text-red">{usd(m.total)}</div>
        </div>
        <div className="text-right">
          <div className="text-[10.5px] text-steel mb-1">Lo que cubre el 6%</div>
          <div className="font-display text-[18px] font-bold leading-none">{usd(m.reserve)}</div>
          <div className="text-[10px] text-steel mt-0.5">6% de {usd(m.soldCost)} vendidos al costo</div>
        </div>
      </div>

      <div className="h-2 rounded-full bg-cloud overflow-hidden mb-1.5" role="img" aria-label={`Pérdidas usan ${Math.round(usedPct)}% de lo que cubre el 6%`}>
        <div className={`h-full rounded-full ${covered ? "bg-teal" : "bg-red"}`} style={{ width: `${usedPct}%` }} />
      </div>
      <div className={`text-[12.5px] font-semibold mb-3 ${covered ? "text-teal" : "text-red"}`}>
        {covered ? `Alcanza — sobran ${usd(diff)}` : `No alcanza — faltan ${usd(diff)}`}
        {m.neededPct != null && (
          <span className="font-normal text-steel">
            {" "}
            · las pérdidas fueron el {m.neededPct.toLocaleString("es-EC")}% de lo vendido{!covered ? `; el seguro tendría que ser ${m.neededPct.toLocaleString("es-EC")}% para cubrir todo` : ""}
          </span>
        )}
      </div>

      <div className="flex flex-col divide-y divide-rule text-[12px]">
        {rows.map((r) => (
          <div key={r.label} className="flex items-start justify-between gap-3 py-1.5">
            <div className="min-w-0">
              <div>{r.label}</div>
              <div className="text-[10.5px] text-steel">{r.hint}</div>
            </div>
            <span className={`shrink-0 font-semibold ${r.total > 0 ? "text-red" : "text-steel"}`}>{usd(r.total)}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

export function LossCoveragePanel({ data }: { data: { current: LossCoverageMonth; previous: LossCoverageMonth | null } }) {
  return (
    <div className="flex flex-col gap-3">
      <div className="flex items-center gap-1.5 flex-wrap">
        <span className="font-semibold text-[13.5px]">¿Alcanza el 6% para cubrir las pérdidas?</span>
        <KpiInfoTip>
          <b className="text-ink">Cada precio de Dropi lleva un 6% extra pensado como seguro.</b> Acá se compara ese 6% (sobre lo vendido en los cortes del mes, al costo) contra todo lo que se perdió: garantías, deterioro dado de baja, reclamos que el proveedor rechazó y devoluciones que llegaron dañadas sin arreglo. No cuenta lo que se arregló, lo que el proveedor cambió o pagó con crédito, ni lo que sigue en trámite. Si las pérdidas pasan el 6%, el seguro no está alcanzando. Solo lo ven el admin y Finanzas.
        </KpiInfoTip>
      </div>
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-3">
        <MonthCard m={data.current} />
        {data.previous && <MonthCard m={data.previous} />}
      </div>
    </div>
  );
}
