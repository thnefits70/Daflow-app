import { prisma } from "@/lib/prisma";
import { TopLine } from "@/components/ui/TopLine";
import { ManageDepartments } from "./ManageDepartments";

export default async function AreasPage() {
  const departments = await prisma.department.findMany({
    where: { isSpecial: false },
    orderBy: { order: "asc" },
  });

  return (
    <div>
      <TopLine eyebrow="Administración" title="Áreas del negocio" />
      <ManageDepartments
        departments={departments.map((d) => ({ id: d.id, name: d.name, code: d.code }))}
      />
    </div>
  );
}
