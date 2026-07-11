import { redirect, notFound } from "next/navigation";
import { auth } from "@/auth";
import { prisma } from "@/lib/prisma";
import { ProcessEditor } from "@/components/process/ProcessEditor";

export default async function EmployeeProcessPage({
  params,
}: {
  params: Promise<{ processId: string }>;
}) {
  const session = await auth();
  if (!session?.user.deptId) redirect("/login");

  const { processId } = await params;
  const process = await prisma.process.findUnique({
    where: { id: processId },
    include: {
      flowSteps: {
        include: { branches: true, checklistItems: { orderBy: { order: "asc" } } },
        orderBy: { order: "asc" },
      },
      checklistItems: { orderBy: { order: "asc" } },
    },
  });
  if (!process || process.deptId !== session.user.deptId) notFound();

  return (
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
      backHref="/area/workspace"
      editable={false}
    />
  );
}
