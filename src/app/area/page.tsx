import { redirect } from "next/navigation";
import { auth } from "@/auth";
import { prisma } from "@/lib/prisma";
import { getWeeklyTrend, getFillRateTrend, getDashboardData } from "@/lib/dashboard";
import { EmployeeHome } from "@/components/dashboard/EmployeeHome";

export default async function AreaHomePage() {
  const session = await auth();
  if (!session?.user.deptId) redirect("/login");

  const deptId = session.user.deptId;
  const [dept, procs, docs, examCount, scores, weeklyTrend, fillRateTrend, dashboardData] = await Promise.all([
    prisma.department.findUnique({ where: { id: deptId } }),
    prisma.process.count({ where: { deptId } }),
    prisma.document.count({ where: { deptId } }),
    prisma.exam.count({ where: { deptId } }),
    prisma.examScore.findMany({
      where: { userId: session.user.id },
      include: { exam: { select: { title: true } } },
      orderBy: { createdAt: "desc" },
    }),
    getWeeklyTrend(),
    getFillRateTrend(),
    getDashboardData(),
  ]);
  if (!dept) redirect("/api/auth/force-logout");

  return (
    <EmployeeHome
      userName={session.user.name ?? ""}
      deptName={dept.name}
      procs={procs}
      docs={docs}
      examCount={examCount}
      trackKpis={dept.trackKpis}
      weeklyTrend={weeklyTrend}
      fillRateTrend={fillRateTrend}
      rowsSorted={dashboardData.rowsSorted}
      scores={scores.map((s) => ({
        id: s.id,
        examTitle: s.exam.title,
        score: s.score,
        total: s.total,
        createdAt: s.createdAt.toISOString(),
      }))}
    />
  );
}
