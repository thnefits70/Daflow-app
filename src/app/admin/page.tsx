import { getDashboardData } from "@/lib/dashboard";
import { Dashboard } from "@/components/dashboard/Dashboard";

export default async function AdminHomePage() {
  const data = await getDashboardData();
  return <Dashboard data={data} />;
}
