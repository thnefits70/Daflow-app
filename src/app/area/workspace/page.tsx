import { redirect } from "next/navigation";
import { auth } from "@/auth";
import { prisma } from "@/lib/prisma";
import { TopLine } from "@/components/ui/TopLine";
import { DeptWorkspaceTabs } from "@/components/dept/DeptWorkspaceTabs";

export default async function WorkspacePage() {
  const session = await auth();
  if (!session?.user.deptId) redirect("/login");

  const dept = await prisma.department.findUnique({ where: { id: session.user.deptId } });
  if (!dept) redirect("/api/auth/force-logout");

  const [processes, documents, exams, kpiRecords, weeklyMetricRecords, weeklyReviewRecords, currentUser] = await Promise.all([
    prisma.process.findMany({
      where: { deptId: dept.id },
      orderBy: { createdAt: "asc" },
      include: { _count: { select: { flowSteps: true, checklistItems: true } } },
    }),
    prisma.document.findMany({ where: { deptId: dept.id }, orderBy: { createdAt: "asc" } }),
    prisma.exam.findMany({
      where: { deptId: dept.id },
      orderBy: { createdAt: "asc" },
      include: { _count: { select: { questions: true } } },
    }),
    dept.trackKpis
      ? prisma.financeKpiRecord.findMany({ where: { deptId: dept.id }, orderBy: { period: "asc" } })
      : Promise.resolve([]),
    dept.trackWeeklyMetric
      ? prisma.weeklyMetricRecord.findMany({ where: { deptId: dept.id }, orderBy: { week: "asc" } })
      : Promise.resolve([]),
    dept.trackWeeklyReview
      ? prisma.weeklyReviewRecord.findMany({ where: { deptId: dept.id }, orderBy: { week: "asc" } })
      : Promise.resolve([]),
    prisma.user.findUnique({ where: { id: session.user.id }, select: { isLeader: true, leadsDeptId: true } }),
  ]);

  const kpisEditable = !!currentUser?.isLeader && currentUser.leadsDeptId === dept.id;

  return (
    <div>
      <TopLine eyebrow={`Área · ${dept.code}`} title={dept.name} />
      <DeptWorkspaceTabs
        deptId={dept.id}
        processesBaseHref="/area/workspace/processes"
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
        trackWeeklyMetric={dept.trackWeeklyMetric}
        weeklyMetricRecords={weeklyMetricRecords.map((w) => ({ id: w.id, week: w.week, value: w.value }))}
        trackWeeklyReview={dept.trackWeeklyReview}
        weeklyReviewRecords={weeklyReviewRecords.map((w) => ({
          id: w.id,
          week: w.week,
          problem: w.problem,
          actionPlan: w.actionPlan,
          status: w.status,
        }))}
        editable={false}
        kpisEditable={kpisEditable}
      />
    </div>
  );
}
