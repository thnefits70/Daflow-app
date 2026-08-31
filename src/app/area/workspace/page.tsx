import { redirect } from "next/navigation";
import { auth } from "@/auth";
import { prisma } from "@/lib/prisma";
import { TopLine } from "@/components/ui/TopLine";
import { DeptWorkspaceTabs } from "@/components/dept/DeptWorkspaceTabs";
import { getUnseenFeedbackCount, canManageStoreFeedback as checkCanManageStoreFeedback, canViewStoreFeedback as checkCanViewStoreFeedback, canSubmitPurchaseRequests, canConfirmPurchaseReceiving, canReceivePurchasesTeam, canActOnPurchaseReceiving, canRegisterPurchaseInvoices, canPayMerchandisePurchases, canManageInventoryControl as checkCanManageInventoryControl, canViewInventoryKpisPanel as checkCanViewInventoryKpisPanel, canManageAdminPayments as checkCanManageAdminPayments, canViewMarketingArrivals as checkCanViewMarketingArrivals, canConfirmMarketingDesign as checkCanConfirmMarketingDesign, canConfirmMarketingAdvisor as checkCanConfirmMarketingAdvisor, canCaptureMerchandiseReentry, canApproveMerchandiseReentry, canActOnMerchandiseReentry, canCloseMerchandiseReentry, canVerifyDamageDisposal, canManageJustUpload, canManageJustCatalog, canCaptureMerchandiseOutflow, canActOnMerchandiseOutflow, canViewMerchandiseOutflow, canConfirmSupplierExchangeFinanceWriteOff, canSubmitCancelledGuide, canConfirmCancelledGuideFulfillment, canManageCancelledGuideCutoff, canDeclareExternalSales, canReviewExternalSales, canConfirmExternalSalePayment, canInvoiceExternalSale, canAssignExternalSalePack, canPackExternalSale, canCloseExternalSale, canViewExternalSales, getSupplierAccess, canAddSupplierBankAccounts } from "@/lib/guards";
import { getFinanceKpiData } from "@/lib/financeKpis";
import { getDeptProcessDetail } from "@/lib/processDetail";
import { getPaymentRemindersData } from "@/lib/paymentReminders";
import { getPeriodicReminders } from "@/lib/periodicReminders";
import { getSupplierExchangeGestorCount } from "@/lib/pendingTasks";
import { getStoreFeedbackData, getStoreFeedbackMonthlyAggregates } from "@/lib/storeFeedback";
import { getReviewsInvolvingUser, weeksStaleOf } from "@/lib/weeklyCheckin";
import { getInventoryControlData, getInventoryKpisData } from "@/lib/inventoryKpis";
import { getPettyCashViewerData } from "@/lib/pettyCash";
import { toSupplierDTO } from "@/lib/suppliers";

const supplierInclude = {
  contacts: { orderBy: { id: "asc" as const } },
  channels: { orderBy: { id: "asc" as const } },
  createdBy: { select: { name: true } },
  approvedBy: { select: { name: true } },
  _count: { select: { bankAccounts: true } },
};

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
  const [canSubmitPurchases, canReceivePurchases, canReceivePurchasesTeamFlag, canApprovePurchaseReceivingFlag, canInvoicePurchases, canPayMerchandisePurchasesFlag] = await Promise.all([
    canSubmitPurchaseRequests(),
    canConfirmPurchaseReceiving(),
    canReceivePurchasesTeam(),
    canActOnPurchaseReceiving(),
    canRegisterPurchaseInvoices(),
    canPayMerchandisePurchases(),
  ]);

  // Proveedores — movido de su propio ítem de sidebar a la pestaña
  // "Proveedores" de Mi área de trabajo (confirmado 2026-08-21), mismo
  // criterio de acceso que la extinta /area/proveedores.
  const [supplierAccess, canAddSupplierBankAccountsFlag] = await Promise.all([
    getSupplierAccess(),
    canAddSupplierBankAccounts(),
  ]);
  const canReviewSuppliers = supplierAccess.isLeader && !!supplierAccess.leadsDeptId;
  const canViewSuppliersAny = supplierAccess.canView || canSubmitPurchases || canAddSupplierBankAccountsFlag;
  const canAddSupplierCarrier = supplierAccess.canAdd || canSubmitPurchases;
  const canAccessSuppliers = canViewSuppliersAny || supplierAccess.canAdd || canReviewSuppliers;

  // Control de Inventario — mismo patrón sin dept.code (confirmado
  // 2026-08-04): Daniel lo ve desde su propia "Mi área de trabajo" sin
  // importar si su departamento real es INV.
  const canManageInventoryControl = await checkCanManageInventoryControl();
  // KPIs de inventario completos en "Mi área de trabajo" — confirmado
  // 2026-08-05: solo Daniel (INV) y Bryan (MKT), Nairoby/admin ya lo ven vía
  // KPIs financieros → Inventario (ver canViewInventoryKpisPanel en guards.ts).
  const canViewInventoryKpisPanel = await checkCanViewInventoryKpisPanel();
  // Reingreso de Mercadería — movido de su propio ítem de sidebar a esta
  // pestaña (confirmado 2026-08-21), mismo patrón sin dept.code que Control
  // de Inventario.
  const [canCaptureReentry, canApproveReentry, canActReentry, canCloseReentry, canVerifyReentryDamageDisposal, canManageReentryJustUpload, canManageReentryJustCatalog] = await Promise.all([
    canCaptureMerchandiseReentry(),
    canApproveMerchandiseReentry(),
    canActOnMerchandiseReentry(),
    canCloseMerchandiseReentry(),
    canVerifyDamageDisposal(),
    canManageJustUpload(),
    canManageJustCatalog(),
  ]);
  let merchandiseReentryPendingCount = 0;
  if (canApproveReentry) {
    merchandiseReentryPendingCount = await prisma.merchandiseReentryBatch.count({
      where: { submittedAt: { not: null }, danielApprovedAt: null },
    });
  } else if (canCloseReentry) {
    const [pendingJust, pendingWriteOff] = await Promise.all([
      prisma.merchandiseReentryItem.count({
        where: { goodQty: { gt: 0 }, justUploadedAt: null, batch: { danielApprovedAt: { not: null } } },
      }),
      prisma.merchandiseReentryItem.count({
        where: { damagedQty: { gt: 0 }, damageConfirmed: true, writeOffAt: null, batch: { danielApprovedAt: { not: null } } },
      }),
    ]);
    merchandiseReentryPendingCount = pendingJust + pendingWriteOff;
  }
  // Registro de Egresos — mismo patrón sin dept.code que Reingreso
  // (confirmado 2026-08-25).
  const [canCaptureOutflow, canActOutflow, canViewOutflow] = await Promise.all([
    canCaptureMerchandiseOutflow(),
    canActOnMerchandiseOutflow(),
    canViewMerchandiseOutflow(),
  ]);
  // Confirmado 2026-08-27, pedido explícito del usuario: "Cambio con
  // proveedor" (dentro de Registro de Egresos) debe verse desde "Mi área de
  // trabajo" para quien tiene gestiones propias pendientes, aunque no tenga
  // ningún otro permiso de este módulo (ej. Bryan, que solo entra acá por
  // Guías Canceladas) — ver getSupplierExchangeGestorCount en pendingTasks.ts.
  const supplierExchangeMineCount = await getSupplierExchangeGestorCount(session.user.id);
  // Confirmado 2026-08-27, pedido explícito del usuario: Nairoby confirma la
  // baja financiera de mercadería que un proveedor rechazó — company-wide
  // (no es un dato propio de ella, cualquiera que tenga este permiso ve
  // todos los rechazos pendientes), mismo espíritu que
  // getPurchaseCreditsPendingItem un poco más abajo en este archivo.
  const canConfirmFinanceWriteOffFlag = await canConfirmSupplierExchangeFinanceWriteOff();
  // Confirmado 2026-08-28: pasó a depender de Daniel — solo cuenta como
  // pendiente de Nairoby una vez que él ya confirmó la baja en Just, no
  // antes (ver justWriteOffConfirmedAt en finance-writeoff/route.ts).
  const financeWriteOffPendingCount = canConfirmFinanceWriteOffFlag
    ? await prisma.merchandiseOutflowItem.count({ where: { resolution: "REJECTED", financeWriteOffAt: null, justWriteOffConfirmedAt: { not: null } } })
    : 0;
  // Guías Canceladas (Fase 4) — canConfirmCancelled combina Fulfillment
  // (dedicado) con el equipo de Inventario (ya calculado como canCaptureOutflow).
  const [canSubmitGuide, canConfirmFulfillmentGuide, canCutoffGuide] = await Promise.all([
    canSubmitCancelledGuide(),
    canConfirmCancelledGuideFulfillment(),
    canManageCancelledGuideCutoff(),
  ]);
  const canConfirmGuide = canConfirmFulfillmentGuide || canCaptureOutflow;
  // Ventas Externas (Fase 3) — mismo patrón sin dept.code que lo anterior.
  const [canDeclareSales, canReviewSales, canConfirmSalePayment, canInvoiceSale, canAssignSalePack, canPackSale, canCloseSale, canViewSales] = await Promise.all([
    canDeclareExternalSales(),
    canReviewExternalSales(),
    canConfirmExternalSalePayment(),
    canInvoiceExternalSale(),
    canAssignExternalSalePack(),
    canPackExternalSale(),
    canCloseExternalSale(),
    canViewExternalSales(),
  ]);
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

  const [processDetail, periodicReminders, documents, exams, financeKpiData, paymentReminders, weeklyMetricRecords, weeklyReviewRecords, currentUser, unseenFeedbackCount, storeFeedbackStores, inventoryControlData, inventoryKpisData, pettyCashData, storeFeedbackAggregates, supplierList, supplierPending] = await Promise.all([
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
      ? prisma.weeklyReviewRecord.findMany({
          where: { deptId: dept.id },
          orderBy: { week: "asc" },
          include: { reportedBy: { select: { name: true } }, involvesDept: { select: { name: true } } },
        })
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
    canViewSuppliersAny
      ? prisma.supplier.findMany({ where: { status: "APPROVED" }, orderBy: { name: "asc" }, include: supplierInclude })
      : Promise.resolve([]),
    canReviewSuppliers
      ? prisma.supplier.findMany({
          where: { status: { in: ["PENDING", "REJECTED"] }, createdByDeptId: supplierAccess.leadsDeptId },
          orderBy: { createdAt: "desc" },
          include: supplierInclude,
        })
      : Promise.resolve([]),
  ]);

  const kpisEditable = !!currentUser?.isLeader && currentUser.leadsDeptId === dept.id;
  const weeklyReviewInvolvingMe =
    kpisEditable && dept.trackWeeklyReview ? await getReviewsInvolvingUser(dept.id) : [];

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
                source: w.source,
                reportedByName: w.reportedBy?.name ?? null,
                involvesDeptName: w.involvesDept?.name ?? null,
                involvesRaw: w.involvesRaw,
                involvedNotifiedAt: w.involvedNotifiedAt?.toISOString() ?? null,
                resolutionNote: w.resolutionNote,
                weeksStale: weeksStaleOf(w.week),
              }))
            : []
        }
        weeklyReviewInvolvingMe={weeklyReviewInvolvingMe}
        canManageStoreFeedback={canManageStoreFeedback}
        canViewStoreFeedback={canViewStoreFeedback}
        storeFeedbackStores={storeFeedbackStores}
        storeFeedbackAggregates={storeFeedbackAggregates}
        canSubmitPurchases={canSubmitPurchases}
        canReceivePurchases={canReceivePurchases}
        canReceivePurchasesTeam={canReceivePurchasesTeamFlag}
        canApprovePurchaseReceiving={canApprovePurchaseReceivingFlag}
        canInvoicePurchases={canInvoicePurchases}
        canPayMerchandisePurchases={canPayMerchandisePurchasesFlag}
        canAccessSuppliers={canAccessSuppliers}
        supplierList={supplierList.map((s) => toSupplierDTO(s, false, canAddSupplierBankAccountsFlag))}
        supplierPending={supplierPending.map((s) => toSupplierDTO(s, false, canAddSupplierBankAccountsFlag))}
        canAddSupplier={supplierAccess.canAdd}
        canAddSupplierCarrier={canAddSupplierCarrier}
        canReviewSuppliers={canReviewSuppliers}
        canAddSupplierBankAccounts={canAddSupplierBankAccountsFlag}
        canManageInventoryControl={canManageInventoryControl}
        inventoryControlData={inventoryControlData}
        canViewInventoryKpisPanel={canViewInventoryKpisPanel}
        inventoryKpisData={inventoryKpisData}
        canCaptureMerchandiseReentry={canCaptureReentry}
        canApproveMerchandiseReentry={canApproveReentry}
        canActOnMerchandiseReentry={canActReentry}
        canCloseMerchandiseReentry={canCloseReentry}
        canVerifyDamageDisposal={canVerifyReentryDamageDisposal}
        canManageJustUpload={canManageReentryJustUpload}
        canManageJustCatalog={canManageReentryJustCatalog}
        merchandiseReentryPendingCount={merchandiseReentryPendingCount}
        canCaptureMerchandiseOutflow={canCaptureOutflow}
        canActOnMerchandiseOutflow={canActOutflow}
        canViewMerchandiseOutflow={canViewOutflow}
        supplierExchangeMineCount={supplierExchangeMineCount}
        canConfirmFinanceWriteOff={canConfirmFinanceWriteOffFlag}
        financeWriteOffPendingCount={financeWriteOffPendingCount}
        canSubmitCancelledGuide={canSubmitGuide}
        canConfirmCancelledGuide={canConfirmGuide}
        canCutoffCancelledGuide={canCutoffGuide}
        canDeclareExternalSales={canDeclareSales}
        canReviewExternalSales={canReviewSales}
        canConfirmExternalSalePayment={canConfirmSalePayment}
        canInvoiceExternalSale={canInvoiceSale}
        canAssignExternalSalePack={canAssignSalePack}
        canPackExternalSale={canPackSale}
        canCloseExternalSale={canCloseSale}
        canViewExternalSales={canViewSales}
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
