import { prisma } from "@/lib/prisma";
import { TopLine } from "@/components/ui/TopLine";
import { NominaGrid } from "@/components/nomina/NominaGrid";

export default async function NominaPage() {
  const [users, departments] = await Promise.all([
    prisma.user.findMany({
      orderBy: { name: "asc" },
      select: {
        id: true,
        name: true,
        username: true,
        position: true,
        photoUrl: true,
        deptId: true,
        department: { select: { id: true, name: true, code: true } },
        isLeader: true,
        leadsDeptId: true,
      },
    }),
    prisma.department.findMany({ orderBy: { order: "asc" }, select: { id: true, name: true, code: true } }),
  ]);

  return (
    <div>
      <TopLine eyebrow="Recursos humanos" title="Nómina" />
      <NominaGrid users={users} departments={departments} />
    </div>
  );
}
