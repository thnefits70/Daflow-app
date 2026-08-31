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
import { getStoreFeedbackAggregate, getStoreFeedbackTrend, getStoreFeedbackStoreDetails } from "@/lib/storeFeedback";
import { getDuePeriodicReminders } from "@/lib/periodicReminders";
import { getMyLearningPaths, summarizeMyLearningPaths } from "@/lib/learningPaths";
import { EmployeeHome } from "@/components/dashboard/EmployeeHome";
import { canViewInventoryKpisHome, canJustifyFillRate, canManageStoreFeedback } from "@/lib/guards";
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

  const canJustifyFillRateFlag = fillRateBreakdown ? await canJustifyFillRate() : false;

  // Confirmado 2026-08-31: nombre de tienda + dueño/administrador solo para
  // Nairoby (canManageStoreFeedback) — el resto de la empresa, incluido
  // Bryan, sigue viendo únicamente el agregado en esta misma tarjeta.
  const storeFeedbackDetails =
    storeFeedback && (await canManageStoreFeedback()) ? await getStoreFeedbackStoreDetails(storeFeedback.period) : undefined;

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
      canJustifyFillRate={canJustifyFillRateFlag}
      returnRateTrend={returnRateTrend}
      stockoutWeeks={stockoutWeeks}
      warrantyMonthlyChart={warrantyMonthlyChart}
      warrantyReasonChart={warrantyReasonChart}
      storeFeedback={storeFeedback}
      storeFeedbackTrend={storeFeedbackTrend}
      storeFeedbackDetails={storeFeedbackDetails}
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
