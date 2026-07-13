import { getDashboardData, getWeeklyTrend, getFillRateTrend } from "@/lib/dashboard";
import { Dashboard } from "@/components/dashboard/Dashboard";

export default async function AdminHomePage() {
  const [data, weeklyTrend, fillRateTrend] = await Promise.all([
    getDashboardData(),
    getWeeklyTrend(),
    getFillRateTrend(),
  ]);
  return <Dashboard data={data} weeklyTrend={weeklyTrend} fillRateTrend={fillRateTrend} />;
}
