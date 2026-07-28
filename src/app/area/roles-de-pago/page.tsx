import { redirect } from "next/navigation";
import { auth } from "@/auth";
import { prisma } from "@/lib/prisma";
import { TopLine } from "@/components/ui/TopLine";
import { PushTypeToggle } from "@/components/shared/PushTypeToggle";
import { PayStubsPanel } from "@/components/payroll/PayStubsPanel";
import { canManagePayroll } from "@/lib/guards";

export default async function AreaRolesDePagoPage() {
  const session = await auth();
  if (!session) redirect("/login");

  const canManage = await canManagePayroll();

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
      <PayStubsPanel
        mode={canManage ? "manage" : "own"}
        departments={departments}
        ownUserId={canManage ? undefined : session.user.id}
      />
    </div>
  );
}
