import { prisma } from "@/lib/prisma";
import { TopLine } from "@/components/ui/TopLine";
import { NominaPageTabs } from "@/components/nomina/NominaPageTabs";
import {
  canLogOvertimeHours,
  canApproveOvertimeHours,
  canViewPayrollRoles,
  canEditPayrollRoles,
  canProposeCommissionAmounts,
  canApproveCommissionAmounts,
  canGrantCeoBonus,
  canConfirmPersonalPurchaseFinance,
  canManageSalaryAdvances,
  canCreateManagementDeduction,
} from "@/lib/guards";

export default async function NominaPage() {
  const [
    users,
    departments,
    canLogOvertime,
    canApproveOvertime,
    canViewRoles,
    canEditRoles,
    canProposeCommissions,
    canApproveCommissions,
    canGrantBonus,
    canConfirmPurchasesFinance,
    canAdvances,
    canDeductions,
  ] = await Promise.all([
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
    canLogOvertimeHours(),
    canApproveOvertimeHours(),
    canViewPayrollRoles(),
    canEditPayrollRoles(),
    canProposeCommissionAmounts(),
    canApproveCommissionAmounts(),
    canGrantCeoBonus(),
    canConfirmPersonalPurchaseFinance(),
    canManageSalaryAdvances(),
    canCreateManagementDeduction(),
  ]);

  return (
    <div>
      <TopLine eyebrow="Recursos humanos" title="Nómina" />
      <NominaPageTabs
        users={users}
        departments={departments}
        canLogOvertime={canLogOvertime}
        canApproveOvertime={canApproveOvertime}
        canViewRoles={canViewRoles}
        canEditRoles={canEditRoles}
        canProposeCommissions={canProposeCommissions}
        canApproveCommissions={canApproveCommissions}
        canGrantCeoBonus={canGrantBonus}
        canConfirmPersonalPurchaseFinance={canConfirmPurchasesFinance}
        canManageSalaryAdvances={canAdvances}
        canCreateManagementDeduction={canDeductions}
      />
    </div>
  );
}
