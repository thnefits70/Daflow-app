import { prisma } from "@/lib/prisma";
import { TopLine } from "@/components/ui/TopLine";
import { SuppliersPanel } from "@/components/suppliers/SuppliersPanel";
import { toSupplierDTO } from "@/lib/suppliers";

const supplierInclude = {
  contacts: { orderBy: { id: "asc" as const } },
  createdBy: { select: { name: true } },
  approvedBy: { select: { name: true } },
};

export default async function AdminProveedoresPage() {
  const [suppliers, pending] = await Promise.all([
    prisma.supplier.findMany({ where: { status: "APPROVED" }, orderBy: { name: "asc" }, include: supplierInclude }),
    prisma.supplier.findMany({
      where: { status: { in: ["PENDING", "REJECTED"] } },
      orderBy: { createdAt: "desc" },
      include: supplierInclude,
    }),
  ]);

  return (
    <div>
      <TopLine eyebrow="Directorio" title="Proveedores" />
      <SuppliersPanel
        suppliers={suppliers.map(toSupplierDTO)}
        pending={pending.map(toSupplierDTO)}
        canAdd
        canReview
        isAdmin
      />
    </div>
  );
}
