import { redirect } from "next/navigation";
import { auth } from "@/auth";
import { prisma } from "@/lib/prisma";
import { TopLine } from "@/components/ui/TopLine";
import { PushTypeToggle } from "@/components/shared/PushTypeToggle";
import { PayStubsPanel } from "@/components/payroll/PayStubsPanel";
import { RolesDePagoTabs } from "@/components/payroll/RolesDePagoTabs";
import { canManagePayroll, canEditPayrollRoles } from "@/lib/guards";

export default async function AreaRolesDePagoPage() {
  const session = await auth();
  if (!session) redirect("/login");

  const canManage = await canManagePayroll();
  const canEditExternal = await canEditPayrollRoles();

  const departments = canManage
    ? await prisma.department.findMany({
        where: { isSpecial: false },
        orderBy: { order: "asc" },
        select: { id: true, name: true, code: true },
      })
    : undefined;

  return (
    <div>
      <TopLine eyebrow="Nómina" title="Roles de pago" action={<PushTypeToggle type="roles_de_pago" />} />
      {canManage ? (
        <RolesDePagoTabs
          canEditExternal={canEditExternal}
          payStubsPanel={<PayStubsPanel mode="manage" departments={departments} />}
        />
      ) : (
        <PayStubsPanel mode="own" ownUserId={session.user.id} />
      )}
    </div>
  );
}
