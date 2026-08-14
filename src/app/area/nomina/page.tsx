import { notFound } from "next/navigation";
import { prisma } from "@/lib/prisma";
import { TopLine } from "@/components/ui/TopLine";
import { NominaPageTabs } from "@/components/nomina/NominaPageTabs";
import {
  canManageNomina,
  canLogOvertimeHours,
  canApproveOvertimeHours,
  canViewPayrollRoles,
  canEditPayrollRoles,
  canProposeCommissionAmounts,
  canApproveCommissionAmounts,
  canGrantCeoBonus,
} from "@/lib/guards";

export default async function AreaNominaPage() {
  const [canManage, canLogOvertime, canApproveOvertime, canViewRoles, canEditRoles, canProposeCommissions, canApproveCommissions, canGrantBonus] = await Promise.all([
    canManageNomina(),
    canLogOvertimeHours(),
    canApproveOvertimeHours(),
    canViewPayrollRoles(),
    canEditPayrollRoles(),
    canProposeCommissionAmounts(),
    canApproveCommissionAmounts(),
    canGrantCeoBonus(),
  ]);
  // Confirmado 2026-08-13: un líder de área habilitada (Inventario,
  // Fulfillment) necesita entrar acá para registrar horas extra aunque no
  // tenga canManageNomina — antes esta página era exclusiva de Nómina.
  if (!canManage && !canLogOvertime && !canViewRoles) notFound();

  const [users, departments] = await Promise.all([
    prisma.user.findMany({
      orderBy: { name: "asc" },
      select: {
        id: true,
        name: true,
        username: true,
        position: true,
        photoUrl: true,
        deptId: true,
        department: { select: { id: true, name: true, code: true } },
        isLeader: true,
        leadsDeptId: true,
        isActive: true,
      },
    }),
    prisma.department.findMany({ orderBy: { order: "asc" }, select: { id: true, name: true, code: true } }),
  ]);

  return (
    <div>
      <TopLine eyebrow="Recursos humanos" title="Nómina" />
      <NominaPageTabs
        users={canManage ? users : []}
        departments={canManage ? departments : []}
        basePath="/area/nomina"
        canManage={canManage}
        canLogOvertime={canLogOvertime}
        canApproveOvertime={canApproveOvertime}
        canViewRoles={canViewRoles}
        canEditRoles={canEditRoles}
        canProposeCommissions={canProposeCommissions}
        canApproveCommissions={canApproveCommissions}
        canGrantCeoBonus={canGrantBonus}
      />
    </div>
  );
}
