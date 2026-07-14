import { Building2 } from "lucide-react";
import { ScoreGauge } from "./ScoreGauge";
import { WeeklyTrendChart } from "./WeeklyTrendChart";
import { OrgChart } from "./OrgChart";
import type { DashboardData, WeeklyTrend } from "@/lib/dashboard";

function barColor(score: number) {
  if (score >= 75) return "#14C7C7";
  if (score >= 50) return "#1E5EFF";
  return "#C4453A";
}

export function Dashboard({
  data,
  weeklyTrend,
  fillRateTrend,
}: {
  data: DashboardData;
  weeklyTrend?: WeeklyTrend;
  fillRateTrend?: WeeklyTrend;
}) {
  const { rows, rowsSorted, totalAttempts, overallAvg } = data;

  return (
    <div>
      <div className="font-mono text-[10.5px] tracking-[.14em] uppercase text-steel">Resumen general</div>
      <h2 className="font-display text-[24px] mt-0.5 mb-6">Inicio</h2>

      <div className="relative overflow-hidden bg-navy rounded-lg p-6 mb-7 flex flex-wrap items-center gap-8">
        <div>
          <div className="text-[11px] font-semibold tracking-wide uppercase text-[#B9C2CC] mb-2 text-center">
            Nivel de conocimiento
          </div>
          <ScoreGauge score={overallAvg} />
        </div>
        <div className="flex-1 min-w-[220px] flex flex-wrap gap-8">
          <div>
            <div className="font-display text-[30px] font-bold text-white">{rows.length}</div>
            <div className="text-[11.5px] text-[#B9C2CC] mt-0.5">Áreas creadas</div>
          </div>
          <div>
            <div className="font-display text-[30px] font-bold text-white">{totalAttempts}</div>
            <div className="text-[11.5px] text-[#B9C2CC] mt-0.5">Exámenes rendidos por el equipo</div>
          </div>
          <div>
            <div className="font-display text-[30px] font-bold text-white">
              {rowsSorted[0]?.avg !== null && rowsSorted[0] ? rowsSorted[0].dept.code : "—"}
            </div>
            <div className="text-[11.5px] text-[#B9C2CC] mt-0.5">Área líder en conocimiento</div>
          </div>
        </div>
      </div>

      {weeklyTrend && (
        <div className="bg-surface border border-rule rounded-lg p-6 mb-7">
          <WeeklyTrendChart
            label="Pedidos despachados"
            deptName={weeklyTrend.deptName}
            points={weeklyTrend.points}
            weeklyGoal={6000}
          />
        </div>
      )}

      {fillRateTrend && (
        <div className="bg-surface border border-rule rounded-lg p-6 mb-7">
          <WeeklyTrendChart
            label="Fill Rate"
            deptName={fillRateTrend.deptName}
            points={fillRateTrend.points}
            weeklyGoal={100}
            format="percent"
          />
        </div>
      )}

      <OrgChart rowsSorted={rowsSorted} />

      <h3 className="text-[14px] font-semibold mt-7 mb-2.5">Estado de conocimiento por área (de mejor a peor)</h3>
      {rowsSorted.length === 0 && (
        <div className="border-[1.5px] border-dashed border-rule rounded-md p-8.5 text-center text-steel text-[13.5px]">
          Crea áreas para ver su progreso aquí.
        </div>
      )}
      {rowsSorted.map((r, i) => (
        <div key={r.dept.id} className="bg-surface border border-rule rounded p-4.5 mb-3">
          <div className="flex items-center justify-between mb-2">
            <span className="font-semibold text-[13.5px] flex items-center gap-2">
              <span className="font-mono text-steel">#{i + 1}</span>
              <Building2 size={14} /> {r.dept.name}
            </span>
            <span className="font-mono text-[10.5px] bg-cloud border border-rule rounded-full px-2.5 py-1">
              {r.avg !== null ? `${r.avg}% promedio` : "sin exámenes aún"}
            </span>
          </div>
          <div className="w-full h-1.5 bg-cloud rounded-full overflow-hidden">
            <div
              className="h-full rounded-full"
              style={{ width: `${r.avg ?? 0}%`, background: r.avg !== null ? barColor(r.avg) : "#D3DCE8" }}
            />
          </div>
          <div className="text-[12px] text-steel mt-2">
            {r.procs} procesos · {r.docs} documentos · {r.examCount} exámenes · {r.attempts} intentos registrados
          </div>

          {r.ranking.length > 0 && (
            <div className="mt-3 border-t border-rule pt-2.5">
              {r.ranking.map((p, pi) => (
                <div key={p.user} className="flex items-center justify-between py-1 text-[12.5px]">
                  <span>{pi === 0 ? "🥇" : pi === 1 ? "🥈" : pi === 2 ? "🥉" : "•"} {p.user}</span>
                  <span className="font-mono text-steel">
                    {p.avg}% · {p.attempts} intento{p.attempts !== 1 ? "s" : ""}
                  </span>
                </div>
              ))}
            </div>
          )}
        </div>
      ))}
    </div>
  );
}
