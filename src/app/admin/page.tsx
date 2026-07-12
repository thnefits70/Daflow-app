import { getDashboardData, getWeeklyTrend } from "@/lib/dashboard";
import { Dashboard } from "@/components/dashboard/Dashboard";

export default async function AdminHomePage() {
  const [data, weeklyTrend] = await Promise.all([getDashboardData(), getWeeklyTrend()]);
  return <Dashboard data={data} weeklyTrend={weeklyTrend} />;
}
