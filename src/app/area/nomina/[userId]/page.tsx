import { notFound } from "next/navigation";
import { prisma } from "@/lib/prisma";
import { ProfileDetail } from "@/components/nomina/ProfileDetail";
import { canManageNomina, canViewPayrollRoles, canEditPayrollRoles } from "@/lib/guards";

export default async function AreaNominaProfilePage({ params }: { params: Promise<{ userId: string }> }) {
  if (!(await canManageNomina())) notFound();

  const { userId } = await params;

  const [user, departments, positions, canViewPayroll, canEditPayroll, b2bAdvisorHolder] = await Promise.all([
    prisma.user.findUnique({
      where: { id: userId },
      include: {
        milestones: { orderBy: { date: "desc" } },
        examScores: { orderBy: { createdAt: "desc" }, include: { exam: { select: { title: true } } } },
      },
    }),
    prisma.department.findMany({ where: { deletedAt: null }, orderBy: { order: "asc" }, select: { id: true, name: true, code: true } }),
    prisma.position.findMany({ orderBy: { name: "asc" } }),
    canViewPayrollRoles(),
    canEditPayrollRoles(),
    prisma.user.findFirst({ where: { isB2BAdvisor: true }, select: { id: true, name: true } }),
  ]);

  if (!user) notFound();

  return (
    <ProfileDetail
      profile={{
        id: user.id,
        name: user.name,
        username: user.username,
        deptId: user.deptId,
        position: user.position,
        photoUrl: user.photoUrl,
        email: user.email,
        phone: user.phone,
        startDate: user.startDate ? user.startDate.toISOString() : null,
        birthDate: user.birthDate ? user.birthDate.toISOString() : null,
        skills: user.skills,
        cvUrl: user.cvUrl,
        cvName: user.cvName,
        isLeader: user.isLeader,
        leadsDeptId: user.leadsDeptId,
        canManageLaws: user.canManageLaws,
        canAddSuppliers: user.canAddSuppliers,
        canManagePurchases: user.canManagePurchases,
        canManageAdminPayments: user.canManageAdminPayments,
        canRegisterLunchPayments: user.canRegisterLunchPayments,
        canAddSupplierBankAccounts: user.canAddSupplierBankAccounts,
        canManagePettyCashSecundaria: user.canManagePettyCashSecundaria,
        canDeclareExternalSales: user.canDeclareExternalSales,
        canManageLocalWarranties: user.canManageLocalWarranties,
        externalSaleContraEntrega: user.externalSaleContraEntrega,
        canConfirmMarketingDesign: user.canConfirmMarketingDesign,
        canConfirmMarketingAdvisor: user.canConfirmMarketingAdvisor,
        canAssignCancelledGuideItems: user.canAssignCancelledGuideItems,
        canUploadFulfillmentGuides: user.canUploadFulfillmentGuides,
        canUploadRocketSku: user.canUploadRocketSku,
        isReentryResponsible: user.isReentryResponsible,
        canMarkComboCreatedInDropi: user.canMarkComboCreatedInDropi,
        canLinkStoreProducts: user.canLinkStoreProducts,
        canPublishMarketProduct: user.canPublishMarketProduct,
        canBrandMarketProduct: user.canBrandMarketProduct,
        notifyNewIdRealPhotos: user.notifyNewIdRealPhotos,
        canResolveSupplierStockout: user.canResolveSupplierStockout,
        canViewStockLevels: user.canViewStockLevels,
        canViewB2BPricing: user.canViewB2BPricing,
        canViewB2CPricing: user.canViewB2CPricing,
        canViewMarketingArrivalsForDispatch: user.canViewMarketingArrivalsForDispatch,
        marketingAdvisorBrand: user.marketingAdvisorBrand,
        isB2BAdvisor: user.isB2BAdvisor,
        b2bAdvisorTitle: user.b2bAdvisorTitle,
        b2bAdvisorProvisional: user.b2bAdvisorProvisional,
        b2bAdvisorGrantedFlags: user.b2bAdvisorGrantedFlags,
        canManageStoreFeedback: user.canManageStoreFeedback,
        canViewStoreFeedback: user.canViewStoreFeedback,
        excludeFromRecognition: user.excludeFromRecognition,
        isActive: user.isActive,
        twoFactorEnabled: user.twoFactorEnabled,
        milestones: user.milestones.map((m) => ({
          id: m.id,
          title: m.title,
          note: m.note,
          date: m.date.toISOString(),
        })),
        examScores: user.examScores.map((e) => ({
          id: e.id,
          score: e.score,
          total: e.total,
          createdAt: e.createdAt.toISOString(),
          exam: { title: e.exam.title },
        })),
      }}
      departments={departments}
      positions={positions.map((p) => ({ id: p.id, deptId: p.deptId, name: p.name }))}
      basePath="/area/nomina"
      canDelete={false}
      canViewPayroll={canViewPayroll}
      canEditPayroll={canEditPayroll}
      b2bAdvisorHolder={b2bAdvisorHolder}
    />
  );
}
