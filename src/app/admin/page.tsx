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
import { getDuePeriodicReminders } from "@/lib/periodicReminders";
import { getTeamLearningPathResults } from "@/lib/learningPaths";
import { Dashboard } from "@/components/dashboard/Dashboard";

export default async function AdminHomePage() {
  const [data, weeklyTrend, fillRateTrend, returnRateTrend, stockoutWeeks, warrantyMonthlyChart, warrantyReasonChart, storeFeedback, storeFeedbackTrend, duePeriodicReminders, learningPathResults] =
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
      getDuePeriodicReminders("all"),
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
      duePeriodicReminders={duePeriodicReminders}
      learningPathResults={learningPathResults}
    />
  );
}
