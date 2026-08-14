import { redirect } from "next/navigation";
import { auth } from "@/auth";
import { prisma } from "@/lib/prisma";
import {
  getWeeklyTrend,
  getFillRateTrend,
  getLatestFillRateBreakdown,
  getReturnRateTrend,
  getStockoutWeeks,
  getDashboardData,
  getWarrantyMonthlyChart,
  getWarrantyReasonChart,
  getCommissionProgress,
} from "@/lib/dashboard";
import { getStoreFeedbackAggregate, getStoreFeedbackTrend } from "@/lib/storeFeedback";
import { getDuePeriodicReminders } from "@/lib/periodicReminders";
import { getMyLearningPaths, summarizeMyLearningPaths } from "@/lib/learningPaths";
import { EmployeeHome } from "@/components/dashboard/EmployeeHome";
import { canViewInventoryKpisHome } from "@/lib/guards";
import { getInventoryKpisData } from "@/lib/inventoryKpis";

export default async function AreaHomePage() {
  const session = await auth();
  if (!session?.user.deptId) redirect("/login");

  const deptId = session.user.deptId;
  const canSeeInventoryKpis = await canViewInventoryKpisHome();
  const [
    dept,
    procs,
    docs,
    examCount,
    scores,
    weeklyTrend,
    fillRateTrend,
    fillRateBreakdown,
    returnRateTrend,
    stockoutWeeks,
    dashboardData,
    warrantyMonthlyChart,
    warrantyReasonChart,
    storeFeedback,
    storeFeedbackTrend,
    duePeriodicReminders,
    myLearningPaths,
    inventoryKpis,
    commissionProgress,
  ] = await Promise.all([
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
    getLatestFillRateBreakdown(),
    getReturnRateTrend(),
    getStockoutWeeks(),
    getDashboardData(),
    getWarrantyMonthlyChart(),
    getWarrantyReasonChart(),
    getStoreFeedbackAggregate(),
    getStoreFeedbackTrend(),
    getDuePeriodicReminders({ deptId, userId: session.user.id }),
    getMyLearningPaths(session.user.id),
    canSeeInventoryKpis ? getInventoryKpisData() : Promise.resolve(null),
    getCommissionProgress(),
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
      commissionProgress={commissionProgress}
      fillRateTrend={fillRateTrend}
      fillRateBreakdown={fillRateBreakdown}
      returnRateTrend={returnRateTrend}
      stockoutWeeks={stockoutWeeks}
      warrantyMonthlyChart={warrantyMonthlyChart}
      warrantyReasonChart={warrantyReasonChart}
      storeFeedback={storeFeedback}
      storeFeedbackTrend={storeFeedbackTrend}
      duePeriodicReminders={duePeriodicReminders}
      inventoryKpis={inventoryKpis}
      rowsSorted={dashboardData.rowsSorted}
      learningPathSummary={summarizeMyLearningPaths(myLearningPaths)}
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
