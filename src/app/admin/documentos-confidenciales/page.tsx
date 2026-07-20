import { prisma } from "@/lib/prisma";
import { TopLine } from "@/components/ui/TopLine";
import { ConfidentialDocsPanel } from "@/components/confidential/ConfidentialDocsPanel";

export default async function AdminDocumentosConfidencialesPage() {
  const users = await prisma.user.findMany({
    where: { isActive: true },
    orderBy: { name: "asc" },
    select: { id: true, name: true, department: { select: { name: true } } },
  });

  return (
    <div>
      <TopLine eyebrow="Privado" title="Documentos Confidenciales" />
      <ConfidentialDocsPanel
        mode="manage"
        users={users.map((u) => ({ id: u.id, name: u.name, deptName: u.department?.name ?? null }))}
      />
    </div>
  );
}
