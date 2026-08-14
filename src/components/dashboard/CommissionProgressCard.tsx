import type { CommissionProgress } from "@/lib/dashboard";

const TIER_EMOJI: Record<string, string> = { "Raíz": "🌱", "Cosecha": "🌾" };

// Confirmado 2026-08-14: pedido explícito del usuario — visible para TODO
// el equipo (no confidencial, a diferencia de los montos de comisión por
// persona/nivel) para el efecto motivacional buscado. Muestra el promedio
// diario de pedidos despachados de este mes hasta hoy, contra los 3 niveles.
export function CommissionProgressCard({ progress }: { progress: CommissionProgress }) {
  if (!progress) return null;
  const { dailyAvg, tiers } = progress;

  return (
    <div className="bg-surface border border-rule rounded-lg p-5 mb-5">
      <div className="flex items-center justify-between mb-3">
        <div className="font-mono text-[10.5px] tracking-[.14em] uppercase text-steel">Comisión de equipo — este mes</div>
        {dailyAvg !== null && (
          <div className="text-[13px] font-bold tabular-nums">{dailyAvg.toFixed(0)} pedidos/día</div>
        )}
      </div>
      {dailyAvg === null ? (
        <div className="text-steel text-[12.5px]">Todavía no hay datos de Pedidos despachados este mes.</div>
      ) : (
        <div className="flex flex-wrap gap-2">
          {tiers.map((t) => {
            const achieved = dailyAvg >= t.minDailyAvg;
            const isProvedix = t.name === "PROVEDIX";
            return (
              <div
                key={t.id}
                className={`flex items-center gap-1.5 rounded-full px-3 py-1.5 text-[12px] font-semibold border ${
                  achieved ? "border-teal bg-teal/10 text-teal" : "border-rule text-steel"
                } ${achieved && isProvedix ? "shadow-[0_0_10px_rgba(20,199,199,0.5)]" : ""}`}
              >
                {TIER_EMOJI[t.name] && <span>{TIER_EMOJI[t.name]}</span>}
                <span className={isProvedix ? "font-extrabold" : ""}>{t.name}</span>
                <span className="text-steel-dim font-normal">{t.minDailyAvg}-{t.maxDailyAvg ?? "+"}</span>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
