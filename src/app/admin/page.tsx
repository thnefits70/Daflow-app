import { getDashboardData, getWeeklyTrend, getFillRateTrend, getReturnRateTrend, getStockoutWeeks } from "@/lib/dashboard";
import { Dashboard } from "@/components/dashboard/Dashboard";

export default async function AdminHomePage() {
  const [data, weeklyTrend, fillRateTrend, returnRateTrend, stockoutWeeks] = await Promise.all([
    getDashboardData(),
    getWeeklyTrend(),
    getFillRateTrend(),
    getReturnRateTrend(),
    getStockoutWeeks(),
  ]);
  return (
    <Dashboard
      data={data}
      weeklyTrend={weeklyTrend}
      fillRateTrend={fillRateTrend}
      returnRateTrend={returnRateTrend}
      stockoutWeeks={stockoutWeeks}
    />
  );
}
