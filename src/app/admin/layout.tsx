import { redirect } from "next/navigation";
import { auth } from "@/auth";
import { prisma } from "@/lib/prisma";
import { AdminSidebar } from "@/components/shell/AdminSidebar";

export default async function AdminLayout({ children }: { children: React.ReactNode }) {
  const session = await auth();
  if (!session || session.user.role !== "admin") redirect("/login");

  const [allDepartments, settings] = await Promise.all([
    prisma.department.findMany({
      orderBy: { order: "asc" },
      select: { id: true, name: true, code: true, isSpecial: true },
    }),
    prisma.platformSettings.findUnique({ where: { id: "singleton" } }),
  ]);

  const departments = allDepartments.filter((d) => !d.isSpecial);
  const specialDepartments = allDepartments.filter((d) => d.isSpecial);

  return (
    <div className="flex h-screen min-h-0">
      <AdminSidebar departments={departments} specialDepartments={specialDepartments} logoUrl={settings?.logoUrl} />
      <main className="flex-1 overflow-y-auto bg-bg p-9">{children}</main>
    </div>
  );
}
