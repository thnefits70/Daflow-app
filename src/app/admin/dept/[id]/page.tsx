import { notFound } from "next/navigation";
import { prisma } from "@/lib/prisma";
import { TopLine } from "@/components/ui/TopLine";
import { DeptWorkspaceTabs } from "@/components/dept/DeptWorkspaceTabs";

export default async function DeptWorkspacePage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const dept = await prisma.department.findUnique({ where: { id } });
  if (!dept) notFound();

  const [processes, documents, exams, kpiRecords] = await Promise.all([
    prisma.process.findMany({
      where: { deptId: id },
      orderBy: { createdAt: "asc" },
      include: { _count: { select: { flowSteps: true, checklistItems: true } } },
    }),
    prisma.document.findMany({ where: { deptId: id }, orderBy: { createdAt: "asc" } }),
    prisma.exam.findMany({
      where: { deptId: id },
      orderBy: { createdAt: "asc" },
      include: { _count: { select: { questions: true } } },
    }),
    dept.trackKpis
      ? prisma.financeKpiRecord.findMany({ where: { deptId: id }, orderBy: { period: "asc" } })
      : Promise.resolve([]),
  ]);

  return (
    <div>
      <TopLine eyebrow={`Área · ${dept.code}`} title={dept.name} />
      <DeptWorkspaceTabs
        deptId={id}
        processesBaseHref={`/admin/dept/${id}/processes`}
        processes={processes.map((p) => ({
          id: p.id,
          title: p.title,
          description: p.description,
          stepCount: p._count.flowSteps,
          checklistCount: p._count.checklistItems,
        }))}
        documents={documents.map((d) => ({
          id: d.id,
          title: d.title,
          content: d.content,
          link: d.link,
          fileUrl: d.fileUrl,
          fileName: d.fileName,
        }))}
        exams={exams.map((e) => ({ id: e.id, title: e.title, questionCount: e._count.questions }))}
        trackKpis={dept.trackKpis}
        kpiRecords={kpiRecords.map((k) => ({
          id: k.id,
          period: k.period,
          roi: k.roi,
          monthlySales: k.monthlySales,
          monthlyProfit: k.monthlyProfit,
          notes: k.notes,
          fileUrl: k.fileUrl,
          fileName: k.fileName,
        }))}
        editable
      />
    </div>
  );
}
