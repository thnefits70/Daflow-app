import { redirect } from "next/navigation";
import { auth } from "@/auth";
import { prisma } from "@/lib/prisma";
import { TopLine } from "@/components/ui/TopLine";
import { DeptWorkspaceTabs } from "@/components/dept/DeptWorkspaceTabs";
import { getUnseenFeedbackCount } from "@/lib/guards";
import { getFinanceKpiData } from "@/lib/financeKpis";
import { getDeptProcessDetail } from "@/lib/processDetail";
import { getPaymentRemindersData } from "@/lib/paymentReminders";
import { getPeriodicReminders } from "@/lib/periodicReminders";
import { getPurchaseReceipts } from "@/lib/purchaseReceipts";

export default async function WorkspacePage() {
  const session = await auth();
  if (!session?.user.deptId) redirect("/login");

  const dept = await prisma.department.findUnique({ where: { id: session.user.deptId } });
  if (!dept) redirect("/api/auth/force-logout");

  const [processDetail, periodicReminders, documents, exams, financeKpiData, paymentReminders, weeklyMetricRecords, weeklyReviewRecords, currentUser, unseenFeedbackCount, purchaseReceipts] = await Promise.all([
    getDeptProcessDetail(dept.id),
    getPeriodicReminders(dept.id),
    prisma.document.findMany({ where: { deptId: dept.id }, orderBy: { createdAt: "asc" } }),
    prisma.exam.findMany({
      where: { deptId: dept.id },
      orderBy: { createdAt: "asc" },
      include: { _count: { select: { questions: true } } },
    }),
    dept.trackKpis ? getFinanceKpiData(dept.id) : Promise.resolve(undefined),
    dept.trackPaymentReminders ? getPaymentRemindersData(dept.id) : Promise.resolve([]),
    dept.trackWeeklyMetric
      ? prisma.weeklyMetricRecord.findMany({ where: { deptId: dept.id }, orderBy: { week: "asc" } })
      : Promise.resolve([]),
    dept.trackWeeklyReview
      ? prisma.weeklyReviewRecord.findMany({ where: { deptId: dept.id }, orderBy: { week: "asc" } })
      : Promise.resolve([]),
    prisma.user.findUnique({
      where: { id: session.user.id },
      select: { isLeader: true, leadsDeptId: true, canViewPurchaseReceipts: true },
    }),
    getUnseenFeedbackCount(),
    dept.code === "COM" ? getPurchaseReceipts(dept.id) : Promise.resolve([]),
  ]);

  const kpisEditable = !!currentUser?.isLeader && currentUser.leadsDeptId === dept.id;
  // Comprobante de pago — leader of Compras, or anyone the admin has
  // explicitly granted the escape hatch to, regardless of role.
  const canViewPurchaseReceipts = dept.code === "COM" && (kpisEditable || !!currentUser?.canViewPurchaseReceipts);

  return (
    <div>
      <TopLine eyebrow={`Área · ${dept.code}`} title={dept.name} />
      <DeptWorkspaceTabs
        deptId={dept.id}
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
        trackWeeklyReview={dept.trackWeeklyReview && kpisEditable}
        weeklyReviewRecords={
          kpisEditable
            ? weeklyReviewRecords.map((w) => ({
                id: w.id,
                week: w.week,
                problem: w.problem,
                actionPlan: w.actionPlan,
                status: w.status,
              }))
            : []
        }
        canViewPurchaseReceipts={canViewPurchaseReceipts}
        purchaseReceipts={purchaseReceipts}
        isAdmin={false}
        editable={false}
        kpisEditable={kpisEditable}
        unseenFeedbackCount={unseenFeedbackCount}
      />
    </div>
  );
}
