import { notFound } from "next/navigation";
import { prisma } from "@/lib/prisma";
import { ProcessEditor } from "@/components/process/ProcessEditor";
import { ProcessHistoryPanel } from "@/components/process/ProcessHistoryPanel";

export default async function AdminProcessPage({
  params,
}: {
  params: Promise<{ id: string; processId: string }>;
}) {
  const { id, processId } = await params;
  const [process, updates, teamSize] = await Promise.all([
    prisma.process.findUnique({
      where: { id: processId },
      include: {
        flowSteps: {
          include: { branches: true, checklistItems: { orderBy: { order: "asc" } } },
          orderBy: { order: "asc" },
        },
        checklistItems: { orderBy: { order: "asc" } },
      },
    }),
    prisma.processUpdate.findMany({
      where: { processId },
      orderBy: { createdAt: "desc" },
      include: { acks: { select: { userId: true } } },
    }),
    prisma.user.count({ where: { deptId: id, isActive: true } }),
  ]);
  if (!process || process.deptId !== id) notFound();

  return (
    <div>
      <ProcessEditor
        process={{
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
          checklistItems: process.checklistItems.map((c) => ({ id: c.id, text: c.text })),
        }}
        backHref={`/admin/dept/${id}`}
        editable
      />
      <ProcessHistoryPanel
        updates={updates.map((u) => ({
          id: u.id,
          note: u.note,
          createdAt: u.createdAt.toISOString(),
          ackedCount: u.acks.length,
          teamSize,
        }))}
      />
    </div>
  );
}
