import type { MichelleWeekStat } from "@/lib/provedixCases";
import { CASE_TOPICS } from "@/lib/provedixCases";

// Cuánto resuelve Michelle IA sola vs. cuánto pasa a Michelle (la asesora
// humana), por semana (pedido del usuario 2026-10-15). Solo el admin.
export function MichelleStatsCard({
  stats,
  openCases,
}: {
  stats: MichelleWeekStat[];
  openCases: number;
}) {
  const total = stats.reduce(
    (s, w) => ({ conv: s.conv + w.conversations, ai: s.ai + w.resolvedByAi }),
    { conv: 0, ai: 0 },
  );
  const pct = total.conv ? Math.round((total.ai / total.conv) * 100) : null;
  return (
    <div className="bg-surface border border-rule rounded-lg p-5 mb-7">
      <div className="text-[13px] font-semibold">
        Michelle IA: cuánto resuelve sola
      </div>
      <div className="text-[11px] text-steel mb-3">
        Conversaciones del chat de provedix.com por semana (últimas 8).
        &quot;Pasó a la asesora&quot; = Michelle IA creó un caso para Michelle
        (la asesora humana).
        {openCases > 0 && ` Casos abiertos ahora: ${openCases}.`}
      </div>
      {pct != null && (
        <div className="mb-3 text-[22px] font-bold">
          {pct}%{" "}
          <span className="text-[13px] font-normal text-steel">
            resuelto por Michelle IA sin la asesora
          </span>
        </div>
      )}
      {stats.length === 0 ? (
        <div className="text-[12px] text-steel">
          Todavía no hay conversaciones.
        </div>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-[12px]">
            <thead>
              <tr className="text-left text-[10.5px] uppercase tracking-wide text-steel">
                <th className="pb-2 pr-3 font-semibold">Semana del</th>
                <th className="pb-2 pr-3 font-semibold text-right">
                  Conversaciones
                </th>
                <th className="pb-2 pr-3 font-semibold text-right">
                  Resolvió Michelle IA
                </th>
                <th className="pb-2 pr-3 font-semibold text-right">
                  Pasó a la asesora
                </th>
                <th className="pb-2 font-semibold">Temas que pasó</th>
              </tr>
            </thead>
            <tbody>
              {stats.map((w) => (
                <tr key={w.week} className="border-t border-rule">
                  <td className="py-2 pr-3 tabular-nums">
                    {w.week.split("-").reverse().join("/")}
                  </td>
                  <td className="py-2 pr-3 text-right tabular-nums">
                    {w.conversations}
                  </td>
                  <td className="py-2 pr-3 text-right tabular-nums">
                    {w.resolvedByAi} (
                    {w.conversations
                      ? Math.round((w.resolvedByAi / w.conversations) * 100)
                      : 0}
                    %)
                  </td>
                  <td className="py-2 pr-3 text-right tabular-nums">
                    {w.escalated}
                  </td>
                  <td className="py-2 text-steel">
                    {Object.entries(w.topics)
                      .map(([t, n]) => `${CASE_TOPICS[t] ?? t} ${n}`)
                      .join(" · ") || "—"}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
