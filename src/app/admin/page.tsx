import {
  getDashboardData,
  getWeeklyTrend,
  getFillRateTrend,
  getReturnRateTrend,
  getStockoutWeeks,
  getWarrantyMonthlyChart,
  getWarrantyReasonChart,
} from "@/lib/dashboard";
import { getStoreFeedbackAggregate } from "@/lib/storeFeedback";
import { Dashboard } from "@/components/dashboard/Dashboard";

export default async function AdminHomePage() {
  const [data, weeklyTrend, fillRateTrend, returnRateTrend, stockoutWeeks, warrantyMonthlyChart, warrantyReasonChart, storeFeedback] =
    await Promise.all([
      getDashboardData(),
      getWeeklyTrend(),
      getFillRateTrend(),
      getReturnRateTrend(),
      getStockoutWeeks(),
      getWarrantyMonthlyChart(),
      getWarrantyReasonChart(),
      getStoreFeedbackAggregate(),
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
    />
  );
}
