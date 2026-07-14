import { prisma } from "@/lib/prisma";
import { TopLine } from "@/components/ui/TopLine";
import { PayStubsPanel } from "@/components/payroll/PayStubsPanel";

export default async function AdminRolesDePagoPage() {
  const departments = await prisma.department.findMany({
    where: { isSpecial: false },
    orderBy: { order: "asc" },
    select: { id: true, name: true, code: true },
  });

  return (
    <div>
      <TopLine eyebrow="Nómina" title="Roles de pago" />
      <PayStubsPanel mode="manage" departments={departments} />
    </div>
  );
}
