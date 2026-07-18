import { redirect } from "next/navigation";
import { auth } from "@/auth";
import { prisma } from "@/lib/prisma";
import { AdminSidebar } from "@/components/shell/AdminSidebar";
import { TopBanner } from "@/components/shell/TopBanner";
import { BirthdayPopup } from "@/components/birthday/BirthdayPopup";
import { MonthlyRecognitionPopup } from "@/components/recognition/MonthlyRecognitionPopup";
import { getMonthPendingConfirmation } from "@/lib/recognitionAdmin";

export default async function AdminLayout({ children }: { children: React.ReactNode }) {
  const session = await auth();
  if (!session || session.user.role !== "admin") redirect("/login");

  const [allDepartments, settings, pendingSuppliersCount, pendingRecognitionMonth] = await Promise.all([
    prisma.department.findMany({
      orderBy: { order: "asc" },
      select: { id: true, name: true, code: true, isSpecial: true },
    }),
    prisma.platformSettings.findUnique({ where: { id: "singleton" } }),
    prisma.supplier.count({ where: { status: "PENDING" } }),
    getMonthPendingConfirmation(),
  ]);

  const departments = allDepartments.filter((d) => !d.isSpecial);
  const specialDepartments = allDepartments.filter((d) => d.isSpecial);

  return (
    <div className="flex flex-col md:flex-row h-screen min-h-0">
      <AdminSidebar
        departments={departments}
        specialDepartments={specialDepartments}
        logoUrl={settings?.logoUrl}
        pendingSuppliersCount={pendingSuppliersCount}
        pendingRecognitionMonth={pendingRecognitionMonth}
      />
      <main className="flex-1 overflow-y-auto bg-bg p-4 md:p-9">
        <TopBanner bannerUrl={settings?.bannerUrl} />
        {children}
      </main>
      <BirthdayPopup />
      <MonthlyRecognitionPopup />
    </div>
  );
}
