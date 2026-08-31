import {
  getDashboardData,
  getWeeklyTrend,
  getFillRateTrend,
  getLatestFillRateBreakdown,
  getReturnRateTrend,
  getStockoutWeeks,
  getWarrantyMonthlyChart,
  getWarrantyReasonChart,
  getCommissionProgress,
} from "@/lib/dashboard";
import { getStoreFeedbackAggregate, getStoreFeedbackTrend, getStoreFeedbackStoreDetails } from "@/lib/storeFeedback";
import { getTeamLearningPathResults } from "@/lib/learningPaths";
import { getAiSpendOverview } from "@/lib/aiUsage";
import { getPurchaseMerchandisePaymentsShortcut } from "@/lib/pendingTasks";
import { Dashboard } from "@/components/dashboard/Dashboard";

// Confirmado 2026-07-27: el admin no pertenece a ningún área, así que no
// tiene "sus propios" Recordatorios periódicos (esos son siempre por
// departamento) — antes se le mostraban los de TODAS las áreas ("all"), lo
// cual confundía ("¿por qué me aparece esto de Daniel/Inventario?"). Cada
// líder ya ve los suyos en su propio Inicio (`getDuePeriodicReminders({deptId})`
// en area/page.tsx) — el admin ya no ve ninguno aquí.
export default async function AdminHomePage() {
  const [data, weeklyTrend, fillRateTrend, fillRateBreakdown, returnRateTrend, stockoutWeeks, warrantyMonthlyChart, warrantyReasonChart, storeFeedback, storeFeedbackTrend, learningPathResults, aiSpend, commissionProgress, merchandisePayments] =
    await Promise.all([
      getDashboardData(),
      getWeeklyTrend(),
      getFillRateTrend(),
      getLatestFillRateBreakdown(),
      getReturnRateTrend(),
      getStockoutWeeks(),
      getWarrantyMonthlyChart(),
      getWarrantyReasonChart(),
      getStoreFeedbackAggregate(),
      getStoreFeedbackTrend(),
      getTeamLearningPathResults(),
      getAiSpendOverview(),
      getCommissionProgress(),
      getPurchaseMerchandisePaymentsShortcut(),
    ]);
  const storeFeedbackDetails = storeFeedback ? await getStoreFeedbackStoreDetails(storeFeedback.period) : [];
  return (
    <Dashboard
      data={data}
      weeklyTrend={weeklyTrend}
      commissionProgress={commissionProgress}
      fillRateTrend={fillRateTrend}
      fillRateBreakdown={fillRateBreakdown}
      returnRateTrend={returnRateTrend}
      stockoutWeeks={stockoutWeeks}
      warrantyMonthlyChart={warrantyMonthlyChart}
      warrantyReasonChart={warrantyReasonChart}
      storeFeedback={storeFeedback}
      storeFeedbackTrend={storeFeedbackTrend}
      storeFeedbackDetails={storeFeedbackDetails}
      learningPathResults={learningPathResults}
      aiSpendToday={aiSpend.today}
      aiSpendMonth={aiSpend.month}
      merchandisePayments={merchandisePayments}
    />
  );
}
