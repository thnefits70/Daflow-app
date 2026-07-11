import { redirect } from "next/navigation";
import { auth } from "@/auth";
import { prisma } from "@/lib/prisma";
import { AdminSidebar } from "@/components/shell/AdminSidebar";

export default async function AdminLayout({ children }: { children: React.ReactNode }) {
  const session = await auth();
  if (!session || session.user.role !== "admin") redirect("/login");

  const [departments, settings] = await Promise.all([
    prisma.department.findMany({ orderBy: { order: "asc" }, select: { id: true, name: true, code: true } }),
    prisma.platformSettings.findUnique({ where: { id: "singleton" } }),
  ]);

  return (
    <div className="flex h-screen min-h-0">
      <AdminSidebar departments={departments} logoUrl={settings?.logoUrl} />
      <main className="flex-1 overflow-y-auto bg-cloud p-9">{children}</main>
    </div>
  );
}
