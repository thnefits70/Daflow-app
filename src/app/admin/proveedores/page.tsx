import { prisma } from "@/lib/prisma";
import { TopLine } from "@/components/ui/TopLine";
import { SuppliersPanel } from "@/components/suppliers/SuppliersPanel";
import { toSupplierDTO } from "@/lib/suppliers";
import { canViewSupplierBankAccounts } from "@/lib/guards";

const supplierInclude = {
  contacts: { orderBy: { id: "asc" as const } },
  channels: { orderBy: { id: "asc" as const } },
  createdBy: { select: { name: true } },
  approvedBy: { select: { name: true } },
  bankAccounts: { orderBy: { createdAt: "asc" as const }, include: { createdBy: { select: { name: true } } } },
};

export default async function AdminProveedoresPage() {
  const [suppliers, pending, canViewBankAccounts] = await Promise.all([
    prisma.supplier.findMany({ where: { status: "APPROVED" }, orderBy: { name: "asc" }, include: supplierInclude }),
    prisma.supplier.findMany({
      where: { status: { in: ["PENDING", "REJECTED"] } },
      orderBy: { createdAt: "desc" },
      include: supplierInclude,
    }),
    canViewSupplierBankAccounts(),
  ]);

  return (
    <div>
      <TopLine eyebrow="Directorio" title="Proveedores" />
      <SuppliersPanel
        suppliers={suppliers.map((s) => toSupplierDTO(s, canViewBankAccounts))}
        pending={pending.map((s) => toSupplierDTO(s, canViewBankAccounts))}
        canAdd
        canAddCarrier
        canReview
        isAdmin
        canAddBankAccounts
      />
    </div>
  );
}
