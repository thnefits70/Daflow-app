import { redirect } from "next/navigation";
import { auth } from "@/auth";
import { TopLine } from "@/components/ui/TopLine";
import { SalaryAdvancesPanel } from "@/components/salary-advances/SalaryAdvancesPanel";

export default async function AnticiposPage() {
  const session = await auth();
  if (!session) redirect("/login");

  return (
    <div>
      <TopLine eyebrow="Recursos humanos" title="Anticipos" />
      <SalaryAdvancesPanel />
    </div>
  );
}
