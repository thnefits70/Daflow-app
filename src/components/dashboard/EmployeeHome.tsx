import Link from "next/link";
import { GitBranch, FileText, GraduationCap, Scale, ClipboardList, LineChart } from "lucide-react";
import { DailyQuoteBanner } from "./DailyQuoteBanner";
import { RecognitionPodium } from "@/components/recognition/RecognitionPodium";
import { ScoreGauge } from "./ScoreGauge";
import { WeeklyTrendChart } from "./WeeklyTrendChart";
import { KpiTile, FillRateTile, ReturnRateTile, WarrantyMonthTile } from "./KpiTile";
import { StockoutBarChart } from "./StockoutBarChart";
import { PieChart } from "./PieChart";
import { OrgChart } from "./OrgChart";
import type { DashboardRow, WeeklyTrend, StockoutWeekPoint, WarrantyMonthlyChart, PieSlice } from "@/lib/dashboard";

type ScoreRow = { id: string; examTitle: string; score: number; total: number; createdAt: string };

function pct(a: number, b: number) {
  return b === 0 ? 0 : Math.round((a / b) * 100);
}

function scoreColor(score: number) {
  if (score >= 75) return "#14C7C7";
  if (score >= 50) return "#1E5EFF";
  return "#C4453A";
}

export function EmployeeHome({
  userName,
  deptName,
  procs,
  docs,
  examCount,
  trackKpis,
  scores,
  weeklyTrend,
  fillRateTrend,
  returnRateTrend,
  stockoutWeeks,
  warrantyMonthlyChart,
  warrantyReasonChart,
  rowsSorted,
}: {
  userName: string;
  deptName: string;
  procs: number;
  docs: number;
  examCount: number;
  trackKpis: boolean;
  scores: ScoreRow[];
  weeklyTrend?: WeeklyTrend;
  fillRateTrend?: WeeklyTrend;
  returnRateTrend?: WeeklyTrend;
  stockoutWeeks?: StockoutWeekPoint[];
  warrantyMonthlyChart?: WarrantyMonthlyChart | null;
  warrantyReasonChart?: PieSlice[];
  rowsSorted: DashboardRow[];
}) {
  const avg = scores.length
    ? Math.round(scores.reduce((a, s) => a + pct(s.score, s.total), 0) / scores.length)
    : null;
  const firstName = userName.split(" ")[0] || userName;

  return (
    <div>
      <DailyQuoteBanner />
      <div className="flex items-start justify-between gap-4 flex-wrap mb-6">
        <div>
          <div className="font-mono text-[10.5px] tracking-[.14em] uppercase text-steel">Tu resumen</div>
          <h2 className="font-display text-[24px] mt-0.5">
            {firstName ? `Hola, ${firstName}` : "Inicio"}
          </h2>
        </div>
        <RecognitionPodium />
      </div>

      {weeklyTrend && (
        <div className="bg-surface border border-rule rounded-lg p-6 mb-5">
          <WeeklyTrendChart
            label="Pedidos despachados"
            deptName={weeklyTrend.deptName}
            points={weeklyTrend.points}
            weeklyGoal={6000}
          />
        </div>
      )}

      {(warrantyMonthlyChart ||
        (warrantyReasonChart && warrantyReasonChart.length > 0) ||
        fillRateTrend ||
        returnRateTrend ||
        (stockoutWeeks && stockoutWeeks.length > 0)) && (
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 mb-7">
          {warrantyMonthlyChart && (
            <WarrantyMonthTile chart={warrantyMonthlyChart} emptyMessage="Aún no hay categorías cargadas este mes." />
          )}

          {warrantyReasonChart && warrantyReasonChart.length > 0 && (
            <KpiTile
              kicker="Motivos que más se repiten"
              value={String(warrantyReasonChart.reduce((a, s) => a + s.value, 0))}
              period="Últimos 12 meses"
            >
              <PieChart compact title="Motivos que más se repiten" slices={warrantyReasonChart} emptyMessage="Aún no hay suficiente historial." />
            </KpiTile>
          )}

          {fillRateTrend && <FillRateTile trend={fillRateTrend} />}
          {returnRateTrend && <ReturnRateTile trend={returnRateTrend} />}

          {stockoutWeeks && stockoutWeeks.length > 0 && (
            <div className="bg-surface border border-rule rounded-lg p-6 sm:col-span-2">
              <StockoutBarChart points={stockoutWeeks} />
            </div>
          )}
        </div>
      )}

      <OrgChart rowsSorted={rowsSorted} />

      <div className="relative overflow-hidden bg-navy rounded-lg p-6 mb-7 mt-7 flex flex-wrap items-center gap-8">
        <div>
          <div className="text-[11px] font-semibold tracking-wide uppercase text-[#B9C2CC] mb-2 text-center">
            Tu nivel de conocimiento
          </div>
          <ScoreGauge score={avg} />
        </div>
        <div className="flex-1 min-w-[220px] flex flex-wrap gap-8">
          <div>
            <div className="font-display text-[30px] font-bold text-white">{procs}</div>
            <div className="text-[11.5px] text-[#B9C2CC] mt-0.5">Procesos documentados en {deptName}</div>
          </div>
          <div>
            <div className="font-display text-[30px] font-bold text-white">{docs}</div>
            <div className="text-[11.5px] text-[#B9C2CC] mt-0.5">Documentos de referencia</div>
          </div>
          <div>
            <div className="font-display text-[30px] font-bold text-white">{scores.length}</div>
            <div className="text-[11.5px] text-[#B9C2CC] mt-0.5">Exámenes que has rendido</div>
          </div>
        </div>
      </div>

      <h3 className="text-[14px] font-semibold mb-2.5">Accesos rápidos</h3>
      <div className="grid grid-cols-2 gap-3 mb-7">
        <Link
          href="/area/workspace"
          className="bg-surface border border-rule rounded-md p-4.5 hover:border-blue flex items-start gap-3"
        >
          <div className="w-9 h-9 rounded-md bg-blue/15 flex items-center justify-center shrink-0">
            <ClipboardList size={17} className="text-blue" />
          </div>
          <div>
            <div className="font-semibold text-[13.5px] mb-0.5">Mi área de trabajo</div>
            <div className="text-[12px] text-steel">
              {procs} proceso{procs === 1 ? "" : "s"}, {docs} documento{docs === 1 ? "" : "s"} y {examCount} examen
              {examCount === 1 ? "" : "es"} de {deptName}
              {trackKpis ? " · incluye KPIs financieros" : ""}.
            </div>
          </div>
        </Link>
        <Link
          href="/area/leyes"
          className="bg-surface border border-rule rounded-md p-4.5 hover:border-blue flex items-start gap-3"
        >
          <div className="w-9 h-9 rounded-md bg-teal/15 flex items-center justify-center shrink-0">
            <Scale size={17} className="text-teal" />
          </div>
          <div>
            <div className="font-semibold text-[13.5px] mb-0.5">Leyes y Reglamentos</div>
            <div className="text-[12px] text-steel">Normativa y reglamentos de toda la empresa.</div>
          </div>
        </Link>
      </div>

      <div className="flex items-center gap-4 mb-2.5 text-[11px] font-mono text-steel uppercase tracking-wide">
        <span className="flex items-center gap-1"><GitBranch size={12} /> Procesos</span>
        <span className="flex items-center gap-1"><FileText size={12} /> Documentos</span>
        <span className="flex items-center gap-1"><GraduationCap size={12} /> Exámenes</span>
        {trackKpis && <span className="flex items-center gap-1"><LineChart size={12} /> KPIs</span>}
      </div>

      <h3 className="text-[14px] font-semibold mt-6 mb-2.5">Tu historial de exámenes</h3>
      {scores.length === 0 && (
        <div className="border-[1.5px] border-dashed border-rule rounded-md p-8.5 text-center text-steel text-[13.5px]">
          Aún no has rendido exámenes. Entra a &quot;Mi área de trabajo&quot; para ver los disponibles.
        </div>
      )}
      {scores.slice(0, 6).map((s) => {
        const p = pct(s.score, s.total);
        return (
          <div key={s.id} className="bg-surface border border-rule rounded p-3.5 mb-2 flex items-center justify-between gap-3">
            <div className="flex items-center gap-2.5">
              <GraduationCap size={15} className="text-steel shrink-0" />
              <span className="font-semibold text-[13px]">{s.examTitle}</span>
            </div>
            <div className="flex items-center gap-3 shrink-0">
              <span className="text-[12px] text-steel">
                {new Date(s.createdAt).toLocaleDateString()}
              </span>
              <span
                className="font-mono text-[11px] font-semibold px-2.5 py-1 rounded-full"
                style={{ color: scoreColor(p), border: `1px solid ${scoreColor(p)}`, background: `${scoreColor(p)}1a` }}
              >
                {s.score}/{s.total} · {p}%
              </span>
            </div>
          </div>
        );
      })}
    </div>
  );
}
