import type { AiSpendOverview } from "@/lib/aiUsage";

function money(n: number) {
  return `$${n.toFixed(2)}`;
}

export function AiSpendPanel({ overview }: { overview: AiSpendOverview }) {
  const { today, week, month, projectedMonth, byFeature, byActor, daily } = overview;
  const maxFeature = Math.max(1, ...byFeature.map((f) => f.amount));
  const maxDaily = Math.max(0.01, ...daily.map((d) => d.amount));
  const maxActor = Math.max(1, ...byActor.map((a) => a.amount));

  return (
    <div>
      <div className="flex items-start justify-between gap-3 flex-wrap mb-1">
        <div>
          <div className="font-mono text-[10.5px] tracking-[.14em] uppercase text-steel">Gasto de IA</div>
          <h2 className="font-display text-[24px] mt-0.5">Control de Compras · Nancy · Rutas de conocimiento</h2>
        </div>
        <span className="inline-flex items-center gap-1.5 rounded-full border border-rule bg-cloud px-3 py-1 text-[11px] font-semibold text-steel">
          🔒 Solo tú ves este panel
        </span>
      </div>
      <p className="text-[12.5px] text-steel max-w-[620px] mb-6">
        Costo real — tokens que Anthropic reportó en cada llamada, multiplicados por el precio de cada modelo. Se acumula por día, semana y mes, y se
        desglosa por función y por persona/área para notar si alguien está consultando de más.
      </p>

      <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 mb-7">
        <div className="bg-surface border border-rule rounded-lg p-4">
          <div className="font-mono text-[9.5px] font-semibold uppercase tracking-wide text-steel mb-2">Hoy</div>
          <div className="font-display text-[26px] font-bold">{money(today)}</div>
        </div>
        <div className="bg-surface border border-rule rounded-lg p-4">
          <div className="font-mono text-[9.5px] font-semibold uppercase tracking-wide text-steel mb-2">Últimos 7 días</div>
          <div className="font-display text-[26px] font-bold">{money(week)}</div>
        </div>
        <div className="bg-surface border border-rule rounded-lg p-4" style={{ background: "linear-gradient(160deg,#152540,var(--color-surface))" }}>
          <div className="font-mono text-[9.5px] font-semibold uppercase tracking-wide text-steel mb-2">Este mes</div>
          <div className="font-display text-[26px] font-bold">{money(month)}</div>
          <div className="text-[10.5px] text-steel mt-1">
            proyectado a fin de mes: <b className="text-ink">{money(projectedMonth)}</b>
          </div>
        </div>
      </div>

      <div className="bg-surface border border-rule rounded-lg p-5 mb-5">
        <div className="text-[13px] font-semibold mb-3">Por función</div>
        {byFeature.length === 0 && <div className="text-[12px] text-steel">Todavía no hay llamadas de IA registradas este mes.</div>}
        <div className="flex flex-col gap-3">
          {byFeature.map((f) => (
            <div key={f.feature} className="grid grid-cols-[1fr_84px] sm:grid-cols-[180px_1fr_84px] items-center gap-3">
              <div className="text-[12.5px] font-medium hidden sm:block">{f.label}</div>
              <div className="h-2 rounded-full bg-cloud overflow-hidden">
                <div className="h-full rounded-full bg-teal" style={{ width: `${(f.amount / maxFeature) * 100}%` }} />
              </div>
              <div className="text-[12.5px] font-semibold text-right tabular-nums">{money(f.amount)}</div>
              <div className="text-[11px] text-steel sm:hidden">{f.label}</div>
            </div>
          ))}
        </div>
      </div>

      <div className="bg-surface border border-rule rounded-lg p-5 mb-5">
        <div className="text-[13px] font-semibold mb-3">Por persona / función — este mes</div>
        {byActor.length === 0 && <div className="text-[12px] text-steel">Sin actividad todavía.</div>}
        <div className="overflow-x-auto">
          <table className="w-full text-[12.5px]">
            <thead>
              <tr className="text-left text-[10.5px] uppercase tracking-wide text-steel">
                <th className="pb-2 pr-3 font-semibold">Persona</th>
                <th className="pb-2 pr-3 font-semibold">Función</th>
                <th className="pb-2 pr-3 font-semibold text-right">Consultas</th>
                <th className="pb-2 font-semibold text-right">Gasto</th>
              </tr>
            </thead>
            <tbody>
              {byActor.map((a, i) => (
                <tr key={`${a.actorId}-${a.feature}-${i}`} className="border-t border-rule">
                  <td className="py-2.5 pr-3">
                    <div className="font-semibold">{a.actorName}</div>
                    {a.deptName && <div className="text-[10.5px] text-steel">{a.deptName}</div>}
                  </td>
                  <td className="py-2.5 pr-3 text-steel">{a.label}</td>
                  <td className="py-2.5 pr-3 text-right tabular-nums">{a.calls}</td>
                  <td className="py-2.5 text-right tabular-nums font-semibold">
                    <div className="flex items-center justify-end gap-2">
                      <span className="w-14 h-1.5 rounded-full bg-cloud overflow-hidden inline-block">
                        <span className="block h-full bg-teal" style={{ width: `${(a.amount / maxActor) * 100}%` }} />
                      </span>
                      {money(a.amount)}
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      <div className="bg-surface border border-rule rounded-lg p-5">
        <div className="text-[13px] font-semibold mb-3">Gasto por día — este mes</div>
        {daily.length === 0 ? (
          <div className="text-[12px] text-steel">Sin datos todavía este mes.</div>
        ) : (
          <div className="flex items-end gap-1 h-[90px]">
            {daily.map((d) => (
              <div key={d.date} className="flex-1 flex flex-col items-center justify-end group relative">
                <div
                  className="w-full rounded-t bg-teal/70 group-hover:bg-teal transition-colors"
                  style={{ height: `${Math.max(3, (d.amount / maxDaily) * 82)}px` }}
                  title={`${d.date}: ${money(d.amount)}`}
                />
              </div>
            ))}
          </div>
        )}
        <div className="flex justify-between text-[10px] text-steel mt-2">
          <span>{daily[0]?.date ?? ""}</span>
          <span>{daily[daily.length - 1]?.date ?? ""}</span>
        </div>
      </div>
    </div>
  );
}
