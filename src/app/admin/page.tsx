import { prisma } from "@/lib/prisma";
import { getDashboardData } from "@/lib/dashboard";
import { Dashboard } from "@/components/dashboard/Dashboard";

export default async function AdminHomePage() {
  const [data, settings] = await Promise.all([
    getDashboardData(),
    prisma.platformSettings.findUnique({ where: { id: "singleton" } }),
  ]);
  return <Dashboard data={data} bannerUrl={settings?.bannerUrl} />;
}
