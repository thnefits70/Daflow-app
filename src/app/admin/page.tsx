import {
  getDashboardData,
  getWeeklyTrend,
  getFillRateTrend,
  getReturnRateTrend,
  getStockoutWeeks,
  getWarrantyMonthlyChart,
  getWarrantyReasonChart,
} from "@/lib/dashboard";
import { Dashboard } from "@/components/dashboard/Dashboard";

export default async function AdminHomePage() {
  const [data, weeklyTrend, fillRateTrend, returnRateTrend, stockoutWeeks, warrantyMonthlyChart, warrantyReasonChart] =
    await Promise.all([
      getDashboardData(),
      getWeeklyTrend(),
      getFillRateTrend(),
      getReturnRateTrend(),
      getStockoutWeeks(),
      getWarrantyMonthlyChart(),
      getWarrantyReasonChart(),
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
    />
  );
}
