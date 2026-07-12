import { prisma } from "@/lib/prisma";
import { getDashboardData, getWeeklyTrend } from "@/lib/dashboard";
import { Dashboard } from "@/components/dashboard/Dashboard";

export default async function AdminHomePage() {
  const [data, settings, weeklyTrend] = await Promise.all([
    getDashboardData(),
    prisma.platformSettings.findUnique({ where: { id: "singleton" } }),
    getWeeklyTrend(),
  ]);
  return <Dashboard data={data} bannerUrl={settings?.bannerUrl} weeklyTrend={weeklyTrend} />;
}
