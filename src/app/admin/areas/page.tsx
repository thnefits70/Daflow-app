import { prisma } from "@/lib/prisma";
import { TopLine } from "@/components/ui/TopLine";
import { ManageDepartments } from "./ManageDepartments";

export default async function AreasPage() {
  const [departments, deletedDepartments, settings] = await Promise.all([
    prisma.department.findMany({
      where: { isSpecial: false, deletedAt: null },
      orderBy: { order: "asc" },
    }),
    prisma.department.findMany({
      where: { isSpecial: false, deletedAt: { not: null } },
      orderBy: { deletedAt: "desc" },
    }),
    prisma.platformSettings.findUnique({ where: { id: "singleton" }, select: { adminTwoFactorEnabled: true } }),
  ]);

  return (
    <div>
      <TopLine eyebrow="Administración" title="Áreas del negocio" />
      <ManageDepartments
        departments={departments.map((d) => ({ id: d.id, name: d.name, code: d.code }))}
        deletedDepartments={deletedDepartments.map((d) => ({
          id: d.id,
          name: d.name,
          code: d.code,
          deletedAt: d.deletedAt!.toISOString(),
        }))}
        adminTwoFactorEnabled={settings?.adminTwoFactorEnabled ?? false}
      />
    </div>
  );
}
