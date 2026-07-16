import { getDashboardData, getWeeklyTrend, getFillRateTrend, getReturnRateTrend } from "@/lib/dashboard";
import { Dashboard } from "@/components/dashboard/Dashboard";

export default async function AdminHomePage() {
  const [data, weeklyTrend, fillRateTrend, returnRateTrend] = await Promise.all([
    getDashboardData(),
    getWeeklyTrend(),
    getFillRateTrend(),
    getReturnRateTrend(),
  ]);
  return (
    <Dashboard data={data} weeklyTrend={weeklyTrend} fillRateTrend={fillRateTrend} returnRateTrend={returnRateTrend} />
  );
}
