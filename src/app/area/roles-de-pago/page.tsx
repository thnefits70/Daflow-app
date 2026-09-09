import { redirect } from "next/navigation";
import { auth } from "@/auth";
import { prisma } from "@/lib/prisma";
import { TopLine } from "@/components/ui/TopLine";
import { PushTypeToggle } from "@/components/shared/PushTypeToggle";
import { PayStubsPanel } from "@/components/payroll/PayStubsPanel";
import { RolesDePagoTabs } from "@/components/payroll/RolesDePagoTabs";
import { MyExternalPaymentsPanel } from "@/components/payroll/MyExternalPaymentsPanel";
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

  // Confirmado 2026-09-09: quien está en modo de pago externo
  // (PayrollProfile.externalPaymentMode) nunca va a tener un Rol formal que
  // ver acá — en vez de la pantalla "Aún no se ha subido tu rol de pago"
  // (que no le aplica), ve directo su propio historial de comprobantes.
  const myProfile = !canManage
    ? await prisma.payrollProfile.findUnique({ where: { userId: session.user.id }, select: { externalPaymentMode: true } })
    : null;

  return (
    <div>
      <TopLine eyebrow="Nómina" title="Roles de pago" action={<PushTypeToggle type="roles_de_pago" />} />
      {canManage ? (
        <RolesDePagoTabs
          canEditExternal={canEditExternal}
          payStubsPanel={<PayStubsPanel mode="manage" departments={departments} />}
        />
      ) : myProfile?.externalPaymentMode ? (
        <MyExternalPaymentsPanel />
      ) : (
        <PayStubsPanel mode="own" ownUserId={session.user.id} />
      )}
    </div>
  );
}
