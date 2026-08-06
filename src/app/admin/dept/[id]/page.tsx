import { notFound } from "next/navigation";
import { prisma } from "@/lib/prisma";
import { TopLine } from "@/components/ui/TopLine";
import { DeptWorkspaceTabs } from "@/components/dept/DeptWorkspaceTabs";
import { getFinanceKpiData } from "@/lib/financeKpis";
import { getDeptProcessDetail } from "@/lib/processDetail";
import { getPaymentRemindersData } from "@/lib/paymentReminders";
import { getPeriodicReminders } from "@/lib/periodicReminders";
import { getPurchaseReceipts, getPurchaseReceiptCatalogs } from "@/lib/purchaseReceipts";
import { getStoreFeedbackData } from "@/lib/storeFeedback";
import { getInventoryControlData, getInventoryKpisData } from "@/lib/inventoryKpis";
import { getPettyCashViewerData } from "@/lib/pettyCash";

export default async function DeptWorkspacePage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const dept = await prisma.department.findUnique({ where: { id } });
  if (!dept) notFound();

  const [processDetail, periodicReminders, documents, exams, financeKpiData, paymentReminders, weeklyMetricRecords, weeklyReviewRecords, purchaseReceipts, purchaseReceiptCatalogs, storeFeedbackStores, inventoryControlData, inventoryKpisData, pettyCashData] = await Promise.all([
    getDeptProcessDetail(id),
    getPeriodicReminders(id, null),
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
    dept.code === "COM" ? getPurchaseReceiptCatalogs(id) : Promise.resolve({ suppliers: [], banks: [] }),
    dept.code === "MKT" ? getStoreFeedbackData() : Promise.resolve([]),
    dept.code === "INV" ? getInventoryControlData() : Promise.resolve(null),
    dept.code === "INV" || dept.code === "MKT" ? getInventoryKpisData() : Promise.resolve(null),
    dept.code === "FIN" ? getPettyCashViewerData(true) : Promise.resolve(null),
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
        weeklyMetricRecords={weeklyMetricRecords.map((w) => ({
          id: w.id,
          week: w.week,
          value: w.value,
          notDispatched: w.notDispatched,
          prepared: w.prepared,
          generated: w.generated,
          outOfStock: w.outOfStock,
        }))}
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
        purchaseReceiptSuppliers={purchaseReceiptCatalogs.suppliers}
        purchaseReceiptBanks={purchaseReceiptCatalogs.banks}
        canManageStoreFeedback={dept.code === "MKT"}
        storeFeedbackStores={storeFeedbackStores}
        canSubmitPurchases={dept.code === "COM"}
        canReceivePurchases={dept.code === "COM"}
        canInvoicePurchases={dept.code === "COM"}
        canManageInventoryControl={dept.code === "INV"}
        inventoryControlData={inventoryControlData}
        canViewInventoryKpisPanel={dept.code === "INV" || dept.code === "MKT"}
        inventoryKpisData={inventoryKpisData}
        pettyCashData={pettyCashData}
        isAdmin
        editable
      />
    </div>
  );
}
