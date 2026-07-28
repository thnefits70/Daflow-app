import {
  getDashboardData,
  getWeeklyTrend,
  getFillRateTrend,
  getReturnRateTrend,
  getStockoutWeeks,
  getWarrantyMonthlyChart,
  getWarrantyReasonChart,
} from "@/lib/dashboard";
import { getStoreFeedbackAggregate, getStoreFeedbackTrend } from "@/lib/storeFeedback";
import { getTeamLearningPathResults } from "@/lib/learningPaths";
import { Dashboard } from "@/components/dashboard/Dashboard";

// Confirmado 2026-07-27: el admin no pertenece a ningún área, así que no
// tiene "sus propios" Recordatorios periódicos (esos son siempre por
// departamento) — antes se le mostraban los de TODAS las áreas ("all"), lo
// cual confundía ("¿por qué me aparece esto de Daniel/Inventario?"). Cada
// líder ya ve los suyos en su propio Inicio (`getDuePeriodicReminders({deptId})`
// en area/page.tsx) — el admin ya no ve ninguno aquí.
export default async function AdminHomePage() {
  const [data, weeklyTrend, fillRateTrend, returnRateTrend, stockoutWeeks, warrantyMonthlyChart, warrantyReasonChart, storeFeedback, storeFeedbackTrend, learningPathResults] =
    await Promise.all([
      getDashboardData(),
      getWeeklyTrend(),
      getFillRateTrend(),
      getReturnRateTrend(),
      getStockoutWeeks(),
      getWarrantyMonthlyChart(),
      getWarrantyReasonChart(),
      getStoreFeedbackAggregate(),
      getStoreFeedbackTrend(),
      getTeamLearningPathResults(),
    ]);
  return (
    <Dashboard
      data={data}
      weeklyTrend={weeklyTrend}
      fillRateTrend={fillRateTrend}
      returnRateTrend={returnRateTrend}
      stockoutWeeks={stockoutWeeks}
      warrantyMonthlyChart={warrantyMonthlyChart}
      warrantyReasonChart={warrantyReasonChart}
      storeFeedback={storeFeedback}
      storeFeedbackTrend={storeFeedbackTrend}
      learningPathResults={learningPathResults}
    />
  );
}
