import { redirect } from "next/navigation";
import { auth } from "@/auth";
import { prisma } from "@/lib/prisma";
import { AreaGateShell } from "@/components/dept/AreaGateShell";
import type { ProcessDTO } from "@/components/process/ProcessEditor";
import { SUPPLIER_VIEW_DEPT_CODES } from "@/lib/guards";

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

  if (!dept || !currentUser) redirect("/api/auth/force-logout");

  const pendingUpdatesRaw = await prisma.processUpdate.findMany({
    where: { process: { deptId: dept.id }, acks: { none: { userId: session.user.id } } },
    include: { process: { select: { id: true, title: true } } },
    orderBy: { createdAt: "asc" },
  });
  const pendingUpdates = pendingUpdatesRaw.map((u) => ({
    id: u.id,
    processId: u.processId,
    processTitle: u.process.title,
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
        checklistItems: { orderBy: { order: "asc" } },
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
        checklistItems: proc.checklistItems.map((c) => ({ id: c.id, text: c.text })),
      };
    }
  }

  let leaderAlerts: { id: string; processTitle: string; pendingCount: number; teamSize: number }[] = [];
  let ledDeptName: string | null = null;
  if (currentUser.isLeader && currentUser.leadsDeptId) {
    const ledDept = await prisma.department.findUnique({ where: { id: currentUser.leadsDeptId } });
    if (ledDept) {
      ledDeptName = ledDept.name;
      const teamUsers = await prisma.user.findMany({ where: { deptId: ledDept.id }, select: { id: true } });
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

  const showSuppliers =
    SUPPLIER_VIEW_DEPT_CODES.includes(dept.code) || currentUser.canAddSuppliers || currentUser.isLeader;
  const pendingSuppliersCount =
    currentUser.isLeader && currentUser.leadsDeptId
      ? await prisma.supplier.count({ where: { status: "PENDING", createdByDeptId: currentUser.leadsDeptId } })
      : 0;

  return (
    <AreaGateShell
      deptName={dept.name}
      userName={session.user.name ?? ""}
      logoUrl={settings?.logoUrl}
      bannerUrl={settings?.bannerUrl}
      pendingUpdates={pendingUpdates}
      activeProcess={activeProcess}
      snoozeUntil={snoozeUntil}
      leaderAlerts={leaderAlerts}
      ledDeptName={ledDeptName}
      showSuppliers={showSuppliers}
      pendingSuppliersCount={pendingSuppliersCount}
    >
      {children}
    </AreaGateShell>
  );
}
