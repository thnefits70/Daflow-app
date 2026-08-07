import { redirect } from "next/navigation";
import { auth } from "@/auth";
import { prisma } from "@/lib/prisma";
import { AdminSidebar } from "@/components/shell/AdminSidebar";
import { TopBanner } from "@/components/shell/TopBanner";
import { BirthdayPopup } from "@/components/birthday/BirthdayPopup";
import { MonthlyRecognitionPopup } from "@/components/recognition/MonthlyRecognitionPopup";
import { RecognitionLockGate } from "@/components/recognition/RecognitionLockGate";
import type { RecognitionPersonDTO } from "@/components/recognition/RecognitionPanel";
import { getMonthPendingConfirmation } from "@/lib/recognitionAdmin";
import { getRecognitionLockout } from "@/lib/pendingTasks";

export default async function AdminLayout({ children }: { children: React.ReactNode }) {
  const session = await auth();
  if (!session || session.user.role !== "admin") redirect("/login");

  const [allDepartments, settings, pendingSuppliersCount, pendingRecognitionMonth, lockout] = await Promise.all([
    prisma.department.findMany({
      orderBy: { order: "asc" },
      select: { id: true, name: true, code: true, isSpecial: true },
    }),
    prisma.platformSettings.findUnique({ where: { id: "singleton" } }),
    prisma.supplier.count({ where: { status: "PENDING" } }),
    getMonthPendingConfirmation(),
    getRecognitionLockout(true, null),
  ]);

  if (lockout) {
    const leaders = await prisma.user.findMany({
      where: { isLeader: true, isActive: true, excludeFromRecognition: false },
      select: { id: true, name: true, photoUrl: true, position: true, department: { select: { name: true } } },
      orderBy: { name: "asc" },
    });
    const evaluations = await prisma.monthlyEvaluation.findMany({
      where: { month: lockout.month, evaluateeId: { in: leaders.map((u) => u.id) } },
      select: { evaluateeId: true },
    });
    const doneIds = new Set(evaluations.map((e) => e.evaluateeId));
    const lockoutPeople: RecognitionPersonDTO[] = leaders.map((u) => ({
      id: u.id,
      name: u.name,
      photoUrl: u.photoUrl,
      position: u.position,
      deptName: u.department?.name ?? null,
      doneMonths: doneIds.has(u.id) ? [lockout.month] : [],
    }));
    return (
      <RecognitionLockGate
        month={lockout.month}
        deadline={lockout.deadline}
        people={lockoutPeople}
        emptyMessage="No hay líderes registrados todavía."
        logoUrl={settings?.logoUrl}
      />
    );
  }

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
