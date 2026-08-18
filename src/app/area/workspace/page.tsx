import { redirect } from "next/navigation";
import { auth } from "@/auth";
import { prisma } from "@/lib/prisma";
import { TopLine } from "@/components/ui/TopLine";
import { DeptWorkspaceTabs } from "@/components/dept/DeptWorkspaceTabs";
import { getUnseenFeedbackCount, canManageStoreFeedback as checkCanManageStoreFeedback, canViewStoreFeedback as checkCanViewStoreFeedback, canSubmitPurchaseRequests, canConfirmPurchaseReceiving, canReceivePurchasesTeam, canActOnPurchaseReceiving, canRegisterPurchaseInvoices, canManageInventoryControl as checkCanManageInventoryControl, canViewInventoryKpisPanel as checkCanViewInventoryKpisPanel, canManageAdminPayments as checkCanManageAdminPayments, canViewMarketingArrivals as checkCanViewMarketingArrivals, canConfirmMarketingDesign as checkCanConfirmMarketingDesign, canConfirmMarketingAdvisor as checkCanConfirmMarketingAdvisor } from "@/lib/guards";
import { getFinanceKpiData } from "@/lib/financeKpis";
import { getDeptProcessDetail } from "@/lib/processDetail";
import { getPaymentRemindersData } from "@/lib/paymentReminders";
import { getPeriodicReminders } from "@/lib/periodicReminders";
import { getStoreFeedbackData, getStoreFeedbackMonthlyAggregates } from "@/lib/storeFeedback";
import { getInventoryControlData, getInventoryKpisData } from "@/lib/inventoryKpis";
import { getPettyCashViewerData } from "@/lib/pettyCash";

export default async function WorkspacePage() {
  const session = await auth();
  if (!session?.user.deptId) redirect("/login");

  const dept = await prisma.department.findUnique({ where: { id: session.user.deptId } });
  if (!dept) redirect("/api/auth/force-logout");

  // Independiente del departamento propio de la persona (confirmado
  // 2026-07-27) — alguien delegado puntualmente (ej. Nairoby, de Finanzas)
  // debe poder gestionar/ver Servicio Postventa desde su propia "Mi área de
  // trabajo" aunque su departamento no sea Análisis de Mercado.
  const [canManageStoreFeedback, canViewStoreFeedback] = await Promise.all([
    checkCanManageStoreFeedback(),
    checkCanViewStoreFeedback(),
  ]);

  // Mismo patrón sin dept.code — Control de Compras (confirmado 2026-07-30:
  // Bryan y Nairoby están asignados a esto sin ser líderes formales del
  // departamento "Control de Compras", así que se ve en su propia "Mi área
  // de trabajo" sin importar a cuál pertenecen de verdad).
  const [canSubmitPurchases, canReceivePurchases, canReceivePurchasesTeamFlag, canApprovePurchaseReceivingFlag, canInvoicePurchases] = await Promise.all([
    canSubmitPurchaseRequests(),
    canConfirmPurchaseReceiving(),
    canReceivePurchasesTeam(),
    canActOnPurchaseReceiving(),
    canRegisterPurchaseInvoices(),
  ]);

  // Control de Inventario — mismo patrón sin dept.code (confirmado
  // 2026-08-04): Daniel lo ve desde su propia "Mi área de trabajo" sin
  // importar si su departamento real es INV.
  const canManageInventoryControl = await checkCanManageInventoryControl();
  // KPIs de inventario completos en "Mi área de trabajo" — confirmado
  // 2026-08-05: solo Daniel (INV) y Bryan (MKT), Nairoby/admin ya lo ven vía
  // KPIs financieros → Inventario (ver canViewInventoryKpisPanel en guards.ts).
  const canViewInventoryKpisPanel = await checkCanViewInventoryKpisPanel();
  // Pagos administrativos — mismo patrón sin dept.code que Control de
  // Compras (confirmado 2026-08-06).
  const canManageAdminPayments = await checkCanManageAdminPayments();
  // "Mercadería recibida" — confirmado 2026-08-08: por departamento (MKT),
  // no un flag suelto como Control de Compras — cualquiera cuyo
  // departamento real sea Análisis de Mercado la ve.
  const [canViewMarketingArrivals, canConfirmMarketingDesign, canConfirmMarketingAdvisor] = await Promise.all([
    checkCanViewMarketingArrivals(),
    checkCanConfirmMarketingDesign(),
    checkCanConfirmMarketingAdvisor(),
  ]);

  const [processDetail, periodicReminders, documents, exams, financeKpiData, paymentReminders, weeklyMetricRecords, weeklyReviewRecords, currentUser, unseenFeedbackCount, storeFeedbackStores, inventoryControlData, inventoryKpisData, pettyCashData, storeFeedbackAggregates] = await Promise.all([
    getDeptProcessDetail(dept.id),
    getPeriodicReminders(dept.id, session.user.id),
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
      select: {
        isLeader: true,
        leadsDeptId: true,
        defaultWorkspaceTab: true,
      },
    }),
    getUnseenFeedbackCount(),
    canManageStoreFeedback ? getStoreFeedbackData() : Promise.resolve([]),
    canManageInventoryControl ? getInventoryControlData() : Promise.resolve(null),
    canViewInventoryKpisPanel ? getInventoryKpisData() : Promise.resolve(null),
    getPettyCashViewerData(false),
    // Fix confirmado 2026-08-11: canViewStoreFeedback (Bryan) ya no ve el
    // detalle por tienda — solo el resultado agregado por mes.
    canManageStoreFeedback || canViewStoreFeedback ? getStoreFeedbackMonthlyAggregates() : Promise.resolve([]),
  ]);

  const kpisEditable = !!currentUser?.isLeader && currentUser.leadsDeptId === dept.id;

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
        weeklyMetricRecords={weeklyMetricRecords.map((w) => ({
          id: w.id,
          week: w.week,
          value: w.value,
          notDispatched: w.notDispatched,
          prepared: w.prepared,
          generated: w.generated,
          outOfStock: w.outOfStock,
        }))}
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
        canManageStoreFeedback={canManageStoreFeedback}
        canViewStoreFeedback={canViewStoreFeedback}
        storeFeedbackStores={storeFeedbackStores}
        storeFeedbackAggregates={storeFeedbackAggregates}
        canSubmitPurchases={canSubmitPurchases}
        canReceivePurchases={canReceivePurchases}
        canReceivePurchasesTeam={canReceivePurchasesTeamFlag}
        canApprovePurchaseReceiving={canApprovePurchaseReceivingFlag}
        canInvoicePurchases={canInvoicePurchases}
        canManageInventoryControl={canManageInventoryControl}
        inventoryControlData={inventoryControlData}
        canViewInventoryKpisPanel={canViewInventoryKpisPanel}
        inventoryKpisData={inventoryKpisData}
        pettyCashData={pettyCashData}
        canManageAdminPayments={canManageAdminPayments}
        canViewMarketingArrivals={canViewMarketingArrivals}
        canConfirmMarketingDesign={canConfirmMarketingDesign}
        canConfirmMarketingAdvisor={canConfirmMarketingAdvisor}
        preferredTab={currentUser?.defaultWorkspaceTab ?? null}
        isAdmin={false}
        editable={false}
        kpisEditable={kpisEditable}
        unseenFeedbackCount={unseenFeedbackCount}
        currentUserId={session.user.id}
      />
    </div>
  );
}
