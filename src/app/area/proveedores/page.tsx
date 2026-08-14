import { redirect } from "next/navigation";
import { prisma } from "@/lib/prisma";
import { TopLine } from "@/components/ui/TopLine";
import { SuppliersPanel } from "@/components/suppliers/SuppliersPanel";
import { toSupplierDTO } from "@/lib/suppliers";
import { getSupplierAccess, canSubmitPurchaseRequests } from "@/lib/guards";

const supplierInclude = {
  contacts: { orderBy: { id: "asc" as const } },
  channels: { orderBy: { id: "asc" as const } },
  createdBy: { select: { name: true } },
  approvedBy: { select: { name: true } },
};

export default async function AreaProveedoresPage() {
  const [access, canSubmit] = await Promise.all([getSupplierAccess(), canSubmitPurchaseRequests()]);
  const canReview = access.isLeader && !!access.leadsDeptId;
  // Confirmado 2026-08-14: quien ya puede registrar un transportista desde
  // Solicitar (canSubmitPurchaseRequests) también llega a esta pantalla para
  // hacerlo desde la pestaña "Transportistas", aunque su área no tenga
  // acceso al directorio de proveedores normales (ej. Nairoby/FIN).
  const canViewAny = access.canView || canSubmit;
  const canAddCarrier = access.canAdd || canSubmit;
  if (!canViewAny && !access.canAdd && !canReview) redirect("/area");

  const [suppliers, pending] = await Promise.all([
    canViewAny
      ? prisma.supplier.findMany({ where: { status: "APPROVED" }, orderBy: { name: "asc" }, include: supplierInclude })
      : Promise.resolve([]),
    canReview
      ? prisma.supplier.findMany({
          where: { status: { in: ["PENDING", "REJECTED"] }, createdByDeptId: access.leadsDeptId },
          orderBy: { createdAt: "desc" },
          include: supplierInclude,
        })
      : Promise.resolve([]),
  ]);

  return (
    <div>
      <TopLine eyebrow="Directorio" title="Proveedores" />
      <SuppliersPanel
        suppliers={suppliers.map(toSupplierDTO)}
        pending={pending.map(toSupplierDTO)}
        canAdd={access.canAdd}
        canAddCarrier={canAddCarrier}
        canReview={canReview}
        isAdmin={false}
      />
    </div>
  );
}
