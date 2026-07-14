import { redirect } from "next/navigation";
import { prisma } from "@/lib/prisma";
import { TopLine } from "@/components/ui/TopLine";
import { SuppliersPanel } from "@/components/suppliers/SuppliersPanel";
import { toSupplierDTO } from "@/lib/suppliers";
import { getSupplierAccess } from "@/lib/guards";

const supplierInclude = {
  contacts: { orderBy: { id: "asc" as const } },
  createdBy: { select: { name: true } },
  approvedBy: { select: { name: true } },
};

export default async function AreaProveedoresPage() {
  const access = await getSupplierAccess();
  const canReview = access.isLeader && !!access.leadsDeptId;
  if (!access.canView && !access.canAdd && !canReview) redirect("/area");

  const [suppliers, pending] = await Promise.all([
    access.canView
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
        canReview={canReview}
        isAdmin={false}
      />
    </div>
  );
}
