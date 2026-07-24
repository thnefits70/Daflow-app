import { notFound } from "next/navigation";
import { prisma } from "@/lib/prisma";
import { TopLine } from "@/components/ui/TopLine";
import { DeptWorkspaceTabs } from "@/components/dept/DeptWorkspaceTabs";
import { getFinanceKpiData } from "@/lib/financeKpis";
import { getDeptProcessDetail } from "@/lib/processDetail";
import { getPaymentRemindersData } from "@/lib/paymentReminders";
import { getPeriodicReminders } from "@/lib/periodicReminders";
import { getPurchaseReceipts } from "@/lib/purchaseReceipts";

export default async function DeptWorkspacePage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const dept = await prisma.department.findUnique({ where: { id } });
  if (!dept) notFound();

  const [processDetail, periodicReminders, documents, exams, financeKpiData, paymentReminders, weeklyMetricRecords, weeklyReviewRecords, purchaseReceipts] = await Promise.all([
    getDeptProcessDetail(id),
    getPeriodicReminders(id),
    prisma.document.findMany({ where: { deptId: id }, orderBy: { createdAt: "asc" } }),
    prisma.exam.findMany({
      where: { deptId: id },
      orderBy: { createdAt: "asc" },
      include: { _count: { select: { questions: true } } },
    }),
    dept.trackKpis ? getFinanceKpiData(id) : Promise.resolve(undefined),
    dept.trackPaymentReminders ? getPaymentRemindersData(id) : Promise.resolve([]),
    dept.trackWeeklyMetric
      ? prisma.weeklyMetricRecord.findMany({ where: { deptId: id }, orderBy: { week: "asc" } })
      : Promise.resolve([]),
    dept.trackWeeklyReview
      ? prisma.weeklyReviewRecord.findMany({ where: { deptId: id }, orderBy: { week: "asc" } })
      : Promise.resolve([]),
    dept.code === "COM" ? getPurchaseReceipts(id) : Promise.resolve([]),
  ]);

  return (
    <div>
      <TopLine eyebrow={`Área · ${dept.code}`} title={dept.name} />
      <DeptWorkspaceTabs
        deptId={id}
        activeProcess={processDetail?.process ?? null}
        processUpdates={processDetail?.updates ?? []}
        periodicReminders={periodicReminders}
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
        financeKpiData={financeKpiData}
        trackPaymentReminders={dept.trackPaymentReminders}
        paymentReminders={paymentReminders}
        trackWeeklyMetric={dept.trackWeeklyMetric}
        weeklyMetricRecords={weeklyMetricRecords.map((w) => ({ id: w.id, week: w.week, value: w.value, notDispatched: w.notDispatched }))}
        trackWeeklyReview={dept.trackWeeklyReview}
        weeklyReviewRecords={weeklyReviewRecords.map((w) => ({
          id: w.id,
          week: w.week,
          problem: w.problem,
          actionPlan: w.actionPlan,
          status: w.status,
        }))}
        canViewPurchaseReceipts={dept.code === "COM"}
        purchaseReceipts={purchaseReceipts}
        isAdmin
        editable
      />
    </div>
  );
}
