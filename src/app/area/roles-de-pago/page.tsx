import { prisma } from "@/lib/prisma";
import { TopLine } from "@/components/ui/TopLine";
import { PayStubsPanel } from "@/components/payroll/PayStubsPanel";
import { canManagePayroll } from "@/lib/guards";

export default async function AreaRolesDePagoPage() {
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
      <TopLine eyebrow="Nómina" title="Roles de pago" />
      <PayStubsPanel mode={canManage ? "manage" : "own"} departments={departments} />
    </div>
  );
}
