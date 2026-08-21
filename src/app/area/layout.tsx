import { redirect } from "next/navigation";
import { auth } from "@/auth";
import { prisma } from "@/lib/prisma";
import { AreaGateShell } from "@/components/dept/AreaGateShell";
import { MarketingArrivalAlert } from "@/components/marketing/MarketingArrivalAlert";
import type { ProcessDTO } from "@/components/process/ProcessEditor";
import type { RecognitionPersonDTO } from "@/components/recognition/RecognitionPanel";
import {
  SUPPLIER_VIEW_DEPT_CODES,
  canManageNomina,
  canLogOvertimeHours,
  canConfirmPersonalPurchaseInventory,
} from "@/lib/guards";
import { getRecognitionLockout } from "@/lib/pendingTasks";

export default async function AreaLayout({ children }: { children: React.ReactNode }) {
  const session = await auth();
  if (!session || session.user.role !== "employee") redirect("/login");

  const [dept, settings, currentUser] = await Promise.all([
    session.user.deptId
      ? prisma.department.findUnique({ where: { id: session.user.deptId } })
      : Promise.resolve(null),
    prisma.platformSettings.findUnique({ where: { id: "singleton" } }),
    prisma.user.findUnique({ where: { id: session.user.id } }),
  ]);

  if (!dept || !currentUser || !currentUser.isActive) redirect("/api/auth/force-logout");

  // Confirmado 2026-08-07: solo los líderes evalúan (a su propio equipo), así
  // que solo ellos pueden quedar bloqueados — un colaborador normal nunca
  // tiene esta responsabilidad y jamás ve este bloqueo.
  const lockout =
    currentUser.isLeader && currentUser.leadsDeptId ? await getRecognitionLockout(false, currentUser.leadsDeptId) : null;
  let lockoutPeople: RecognitionPersonDTO[] = [];
  if (lockout) {
    const team = await prisma.user.findMany({
      where: { deptId: currentUser.leadsDeptId!, isLeader: false, isActive: true, excludeFromRecognition: false },
      select: { id: true, name: true, photoUrl: true, position: true, department: { select: { name: true } } },
      orderBy: { name: "asc" },
    });
    const evaluations = await prisma.monthlyEvaluation.findMany({
      where: { month: lockout.month, evaluateeId: { in: team.map((u) => u.id) } },
      select: { evaluateeId: true },
    });
    const doneIds = new Set(evaluations.map((e) => e.evaluateeId));
    lockoutPeople = team.map((u) => ({
      id: u.id,
      name: u.name,
      photoUrl: u.photoUrl,
      position: u.position,
      deptName: u.department?.name ?? null,
      doneMonths: doneIds.has(u.id) ? [lockout.month] : [],
    }));
  }

  const pendingUpdatesRaw = await prisma.processUpdate.findMany({
    where: { process: { deptId: dept.id }, acks: { none: { userId: session.user.id } } },
    include: { process: { select: { id: true, title: true } } },
    orderBy: { createdAt: "asc" },
  });
  const pendingUpdates = pendingUpdatesRaw.map((u) => ({
    id: u.id,
    processId: u.processId,
    processTitle: u.process.title,
    note: u.note,
    createdAt: u.createdAt.toISOString(),
  }));

  const snoozeUntil = currentUser.snoozeUntil ? currentUser.snoozeUntil.toISOString() : null;

  let activeProcess: ProcessDTO | null = null;
  if (pendingUpdates.length > 0) {
    const proc = await prisma.process.findUnique({
      where: { id: pendingUpdates[0].processId },
      include: {
        flowSteps: {
          include: { branches: true, checklistItems: { orderBy: { order: "asc" } } },
          orderBy: { order: "asc" },
        },
      },
    });
    if (proc) {
      activeProcess = {
        id: proc.id,
        title: proc.title,
        description: proc.description,
        flowSteps: proc.flowSteps.map((s) => ({
          id: s.id,
          type: s.type,
          label: s.label,
          detail: s.detail,
          fileUrl: s.fileUrl,
          fileName: s.fileName,
          positionX: s.positionX,
          positionY: s.positionY,
          branches: s.branches.map((b) => ({
            id: b.id,
            label: b.label,
            targetStepId: b.targetStepId,
            sourceHandle: b.sourceHandle,
            targetHandle: b.targetHandle,
          })),
          checklistItems: s.checklistItems.map((c) => ({ id: c.id, text: c.text })),
        })),
      };
    }
  }

  let leaderAlerts: { id: string; processTitle: string; pendingCount: number; teamSize: number }[] = [];
  let ledDeptName: string | null = null;
  if (currentUser.isLeader && currentUser.leadsDeptId) {
    const ledDept = await prisma.department.findUnique({ where: { id: currentUser.leadsDeptId } });
    if (ledDept) {
      ledDeptName = ledDept.name;
      const teamUsers = await prisma.user.findMany({ where: { deptId: ledDept.id, isActive: true }, select: { id: true } });
      const updates = await prisma.processUpdate.findMany({
        where: { process: { deptId: ledDept.id } },
        include: { process: { select: { title: true } }, acks: { select: { userId: true } } },
      });
      leaderAlerts = updates
        .map((u) => ({
          id: u.id,
          processTitle: u.process.title,
          pendingCount: teamUsers.filter((t) => !u.acks.some((a) => a.userId === t.id)).length,
          teamSize: teamUsers.length,
        }))
        .filter((a) => a.pendingCount > 0);
    }
  }

  const pendingSuppliersCount =
    currentUser.isLeader && currentUser.leadsDeptId
      ? await prisma.supplier.count({ where: { status: "PENDING", createdByDeptId: currentUser.leadsDeptId } })
      : 0;
  // Proveedores is only for Compras/Análisis de Mercado, whoever was granted
  // canAddSuppliers directly, or a leader who actually has something of
  // their team's waiting to approve — not every leader company-wide.
  const showSuppliers =
    SUPPLIER_VIEW_DEPT_CODES.includes(dept.code) || currentUser.canAddSuppliers || pendingSuppliersCount > 0;
  const unseenFeedbackCount =
    currentUser.isLeader && currentUser.leadsDeptId
      ? await prisma.weeklyReviewRecord.count({
          where: { deptId: currentUser.leadsDeptId, updatedAt: { gt: currentUser.lastSeenFeedbackAt ?? new Date(0) } },
        })
      : 0;
  const unseenPayStubCount = await prisma.payStub.count({
    where: { userId: session.user.id, updatedAt: { gt: currentUser.lastSeenPayStubAt ?? new Date(0) } },
  });
  const confidentialAccessCount = await prisma.confidentialDocumentAccess.count({
    where: { userId: session.user.id },
  });
  const unseenConfidentialCount = await prisma.confidentialDocumentAccess.count({
    where: { userId: session.user.id, seenAt: null },
  });
  // Always true now — confirmed 2026-07-22: Servicio Postventa's company-wide
  // average is public to every employee, even those with no other KPI edit
  // rights. The page itself still gates each individual section's edit UI.
  const showKpis = true;
  // Confirmado 2026-08-13: pedido explícito del usuario — el líder de un
  // área habilitada para horas extra (hoy Inventario y Fulfillment)
  // necesita entrar acá para registrar, aunque no gestione Nómina en
  // general (esa parte de la pantalla queda oculta para él, ver
  // NominaPageTabs).
  const showNomina = (await canManageNomina()) || (await canLogOvertimeHours());
  const showPersonalPurchasesInventory = await canConfirmPersonalPurchaseInventory();
  const myLearningPathCount = await prisma.learningPathAssignment.count({ where: { userId: session.user.id } });

  return (
    <AreaGateShell
      deptName={dept.name}
      userName={session.user.name ?? ""}
      userPhotoUrl={currentUser.photoUrl}
      logoUrl={settings?.logoUrl}
      bannerUrl={settings?.bannerUrl}
      recognitionLockout={lockout}
      recognitionLockoutPeople={lockoutPeople}
      pendingUpdates={pendingUpdates}
      activeProcess={activeProcess}
      snoozeUntil={snoozeUntil}
      leaderAlerts={leaderAlerts}
      ledDeptName={ledDeptName}
      showSuppliers={showSuppliers}
      pendingSuppliersCount={pendingSuppliersCount}
      unseenFeedbackCount={unseenFeedbackCount}
      unseenPayStubCount={unseenPayStubCount}
      showConfidential={confidentialAccessCount > 0}
      unseenConfidentialCount={unseenConfidentialCount}
      showKpis={showKpis}
      showRecognition
      showNomina={showNomina}
      showMyLearningPath={myLearningPathCount > 0}
      showPersonalPurchasesInventory={showPersonalPurchasesInventory}
    >
      {children}
      {(currentUser.canConfirmMarketingDesign || currentUser.canConfirmMarketingAdvisor) && (
        <MarketingArrivalAlert canConfirmDesign={currentUser.canConfirmMarketingDesign} canConfirmAdvisor={currentUser.canConfirmMarketingAdvisor} />
      )}
    </AreaGateShell>
  );
}
