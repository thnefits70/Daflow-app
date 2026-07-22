// Server-only (prisma). Each department has at most one process today —
// confirmed 2026-07-22: the Procesos tab shows it embedded directly (visual
// flowchart first, an "Editar" button to enter edit mode), not a list you
// click into. Takes the earliest-created if more than one ever exists.
import { prisma } from "@/lib/prisma";
import type { ProcessDTO } from "@/components/process/ProcessEditor";
import type { ProcessUpdateDTO } from "@/components/process/ProcessHistoryPanel";

export type ProcessDetail = { process: ProcessDTO; updates: ProcessUpdateDTO[] };

export async function getDeptProcessDetail(deptId: string): Promise<ProcessDetail | null> {
  const process = await prisma.process.findFirst({
    where: { deptId },
    orderBy: { createdAt: "asc" },
    include: {
      flowSteps: {
        include: { branches: true, checklistItems: { orderBy: { order: "asc" } } },
        orderBy: { order: "asc" },
      },
    },
  });
  if (!process) return null;

  const [updatesRaw, teamSize] = await Promise.all([
    prisma.processUpdate.findMany({
      where: { processId: process.id },
      orderBy: { createdAt: "desc" },
      include: { acks: { select: { userId: true } } },
    }),
    prisma.user.count({ where: { deptId, isActive: true } }),
  ]);

  return {
    process: {
      id: process.id,
      title: process.title,
      description: process.description,
      flowSteps: process.flowSteps.map((s) => ({
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
    },
    updates: updatesRaw.map((u) => ({
      id: u.id,
      note: u.note,
      createdAt: u.createdAt.toISOString(),
      ackedCount: u.acks.length,
      teamSize,
    })),
  };
}
