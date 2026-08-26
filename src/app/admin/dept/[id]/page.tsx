import { notFound } from "next/navigation";
import { prisma } from "@/lib/prisma";
import { TopLine } from "@/components/ui/TopLine";
import { DeptWorkspaceTabs } from "@/components/dept/DeptWorkspaceTabs";
import { getFinanceKpiData } from "@/lib/financeKpis";
import { getDeptProcessDetail } from "@/lib/processDetail";
import { getPaymentRemindersData } from "@/lib/paymentReminders";
import { getPeriodicReminders } from "@/lib/periodicReminders";
import { getStoreFeedbackData } from "@/lib/storeFeedback";
import { getInventoryControlData, getInventoryKpisData } from "@/lib/inventoryKpis";
import { getPettyCashViewerData } from "@/lib/pettyCash";
import { toSupplierDTO } from "@/lib/suppliers";
import { SUPPLIER_VIEW_DEPT_CODES, SUPPLIER_ADD_DEPT_CODES } from "@/lib/guards";

const supplierInclude = {
  contacts: { orderBy: { id: "asc" as const } },
  channels: { orderBy: { id: "asc" as const } },
  createdBy: { select: { name: true } },
  approvedBy: { select: { name: true } },
  bankAccounts: { orderBy: { createdAt: "asc" as const }, include: { createdBy: { select: { name: true } } } },
};

export default async function DeptWorkspacePage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const dept = await prisma.department.findUnique({ where: { id } });
  if (!dept) notFound();

  const canAccessSuppliers = SUPPLIER_VIEW_DEPT_CODES.includes(dept.code);

  const [processDetail, periodicReminders, documents, exams, financeKpiData, paymentReminders, weeklyMetricRecords, weeklyReviewRecords, storeFeedbackStores, inventoryControlData, inventoryKpisData, pettyCashData, supplierList, supplierPending] = await Promise.all([
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
      ? prisma.weeklyReviewRecord.findMany({
          where: { deptId: id },
          orderBy: { week: "asc" },
          include: { reportedBy: { select: { name: true } }, involvesDept: { select: { name: true } } },
        })
      : Promise.resolve([]),
    dept.code === "MKT" ? getStoreFeedbackData() : Promise.resolve([]),
    dept.code === "INV" ? getInventoryControlData() : Promise.resolve(null),
    dept.code === "INV" || dept.code === "MKT" ? getInventoryKpisData() : Promise.resolve(null),
    dept.code === "FIN" ? getPettyCashViewerData(true) : Promise.resolve(null),
    canAccessSuppliers
      ? prisma.supplier.findMany({ where: { status: "APPROVED" }, orderBy: { name: "asc" }, include: supplierInclude })
      : Promise.resolve([]),
    canAccessSuppliers
      ? prisma.supplier.findMany({
          where: { status: { in: ["PENDING", "REJECTED"] }, createdByDeptId: id },
          orderBy: { createdAt: "desc" },
          include: supplierInclude,
        })
      : Promise.resolve([]),
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
          source: w.source,
          reportedByName: w.reportedBy?.name ?? null,
          involvesDeptName: w.involvesDept?.name ?? null,
          involvesRaw: w.involvesRaw,
          involvedNotifiedAt: w.involvedNotifiedAt?.toISOString() ?? null,
        }))}
        canManageStoreFeedback={dept.code === "MKT"}
        storeFeedbackStores={storeFeedbackStores}
        canSubmitPurchases={dept.code === "COM"}
        canReceivePurchases={dept.code === "COM"}
        // Confirmado 2026-08-18: esta página es siempre isAdmin — admin
        // nunca recibe ni aprueba, solo supervisa (ver PurchaseReceivingPanel).
        canReceivePurchasesTeam={false}
        canApprovePurchaseReceiving={false}
        canInvoicePurchases={dept.code === "COM"}
        // Confirmado 2026-08-25: pedido explícito del usuario — admin
        // transfiere realmente la plata de mercadería (Bryan solo
        // solicita), así que puede pagar/cerrar esas solicitudes él mismo.
        // Registrar factura, pagar flete y marcar para revisar siguen
        // exclusivos de Nairoby (ver canPayMerchandisePurchases en
        // guards.ts).
        canPayMerchandisePurchases={dept.code === "COM"}
        canAccessSuppliers={canAccessSuppliers}
        supplierList={supplierList.map((s) => toSupplierDTO(s, true))}
        supplierPending={supplierPending.map((s) => toSupplierDTO(s, true))}
        canAddSupplier={SUPPLIER_ADD_DEPT_CODES.includes(dept.code)}
        canAddSupplierCarrier={dept.code === "MKT" || dept.code === "COM"}
        canReviewSuppliers={canAccessSuppliers}
        canAddSupplierBankAccounts={canAccessSuppliers}
        canManageInventoryControl={dept.code === "INV"}
        inventoryControlData={inventoryControlData}
        canViewInventoryKpisPanel={dept.code === "INV" || dept.code === "MKT"}
        inventoryKpisData={inventoryKpisData}
        // Reingreso de Mercadería — admin no captura (no tiene departamento
        // real, ver guards.ts canCaptureMerchandiseReentry), solo supervisa
        // aprobación/cierre, igual que el resto de esta página de solo
        // oversight. Fix 2026-08-21: aprobar lotes es exclusivo de Daniel
        // (líder de Inventario), ni siquiera admin — mismo criterio que
        // canApprovePurchaseReceiving arriba. Fix 2026-08-24: subir a Just
        // quedó exclusivo de Nairoby (canManageJustUpload=false) y
        // verificar/disponer lo dañado también quedó exclusivo de Nairoby
        // (canVerifyDamageDisposal=false) — admin ve ambas colas en modo
        // solo lectura vía canCloseMerchandiseReentry.
        canCaptureMerchandiseReentry={false}
        canApproveMerchandiseReentry={dept.code === "INV"}
        canActOnMerchandiseReentry={false}
        canCloseMerchandiseReentry={dept.code === "INV"}
        canVerifyDamageDisposal={false}
        canManageJustUpload={false}
        // Ampliado 2026-08-24: admin ahora también puede subir la base de
        // datos de Just (antes exclusivo de Daniel, ver guards.ts
        // canManageJustCatalog) — la pestaña "Base de datos de productos"
        // solo aparece en el contexto de INV de todos modos.
        canManageJustCatalog={dept.code === "INV"}
        // Registro de Egresos — mismo criterio que Reingreso arriba: admin
        // nunca captura ni actúa (ni siquiera dar de baja en Just, ver
        // guards.ts canActOnMerchandiseOutflow), solo supervisa en modo
        // lectura cuando navega el departamento de Inventario.
        canCaptureMerchandiseOutflow={false}
        canActOnMerchandiseOutflow={false}
        canViewMerchandiseOutflow={dept.code === "INV"}
        // Guías Canceladas (Fase 4) — admin nunca reporta ni confirma (no
        // tiene departamento real); el corte semanal SÍ es de admin además
        // de Bryan (mismo bypass ya presente en canManageCancelledGuideCutoff).
        canSubmitCancelledGuide={false}
        canConfirmCancelledGuide={false}
        canCutoffCancelledGuide={dept.code === "MKT"}
        // Ventas Externas (Fase 3) — Bryan revisa (MKT), Nairoby cierra
        // (FIN), admin confirma pago SIEMPRE (no es de ningún departamento
        // en particular, así que no se apaga al navegar otras áreas).
        canDeclareExternalSales={false}
        canReviewExternalSales={dept.code === "MKT"}
        canConfirmExternalSalePayment={true}
        canCloseExternalSale={dept.code === "FIN"}
        canViewExternalSales={true}
        pettyCashData={pettyCashData}
        canManageAdminPayments={dept.code === "FIN"}
        canViewMarketingArrivals={dept.code === "MKT"}
        // Confirmado 2026-08-08: admin ve pero nunca confirma — exclusivo de quien tiene el flag.
        canConfirmMarketingDesign={false}
        canConfirmMarketingAdvisor={false}
        isAdmin
        editable
      />
    </div>
  );
}
