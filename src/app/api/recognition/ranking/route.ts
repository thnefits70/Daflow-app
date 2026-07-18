import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/auth";
import { prisma } from "@/lib/prisma";
import { canAccessRecognition } from "@/lib/guards";
import { currentMonth, rankEvaluations, rankSummaries, MAX_TOTAL_SCORE } from "@/lib/recognition";

// Admin sees the full company-wide ranking (optionally filtered to one
// department); a leader only sees their own team's ranking — one combined
// list mixing leaders and regular employees together, since the title is
// company-wide, not per-department. A month still inside the retention
// window is ranked from the detailed evaluations (drill-down available);
// once purged, it falls back to the permanent summary rows (no drill-down,
// same exact ranking).
export async function GET(req: NextRequest) {
  const canAccess = await canAccessRecognition();
  if (!canAccess) return NextResponse.json({ error: "No autorizado." }, { status: 403 });

  const session = await auth();
  const month = req.nextUrl.searchParams.get("month") ?? currentMonth();
  const deptId = req.nextUrl.searchParams.get("deptId");

  const evaluateeWhere: { deptId: string; isLeader?: boolean } | undefined = (() => {
    if (session!.user.role === "admin") return deptId ? { deptId } : undefined;
    return undefined; // set below once we know the leader's own dept
  })();

  let scopedEvaluateeWhere = evaluateeWhere;
  if (session!.user.role !== "admin") {
    const me = await prisma.user.findUnique({
      where: { id: session!.user.id },
      select: { isLeader: true, leadsDeptId: true },
    });
    if (!me?.isLeader || !me.leadsDeptId) {
      return NextResponse.json({ month, maxTotalScore: MAX_TOTAL_SCORE, ranked: [], months: [] });
    }
    // Only the leader's team, never the leader themselves — their own
    // deptId matches leadsDeptId, so this must be excluded explicitly or
    // they'd show up ranked inside their own team's list.
    scopedEvaluateeWhere = { deptId: me.leadsDeptId, isLeader: false };
  }

  const detailedEvaluations = await prisma.monthlyEvaluation.findMany({
    where: { month, ...(scopedEvaluateeWhere ? { evaluatee: scopedEvaluateeWhere } : {}) },
    include: {
      scores: { select: { pillar: true, questionId: true, score: true } },
      evaluatee: { select: { id: true, name: true, photoUrl: true, isLeader: true, department: { select: { name: true } } } },
    },
  });

  let ranked;
  if (detailedEvaluations.length > 0) {
    ranked = rankEvaluations(detailedEvaluations.map((e) => ({ ...e, evaluatee: e.evaluatee! })));
  } else {
    const summaries = await prisma.monthlyEvaluationSummary.findMany({
      where: { month, ...(scopedEvaluateeWhere ? { evaluatee: scopedEvaluateeWhere } : {}) },
      include: { evaluatee: { select: { id: true, name: true, photoUrl: true, isLeader: true, department: { select: { name: true } } } } },
    });
    ranked = rankSummaries(summaries.map((s) => ({ ...s, evaluatee: s.evaluatee! })));
  }

  const evaluateeFilter = scopedEvaluateeWhere ? { evaluatee: scopedEvaluateeWhere } : {};
  const [detailedMonths, summaryMonths] = await Promise.all([
    prisma.monthlyEvaluation.findMany({ where: evaluateeFilter, distinct: ["month"], select: { month: true } }),
    prisma.monthlyEvaluationSummary.findMany({ where: evaluateeFilter, distinct: ["month"], select: { month: true } }),
  ]);
  const months = [...new Set([...detailedMonths.map((m) => m.month), ...summaryMonths.map((m) => m.month)])].sort().reverse();

  // Only admin can confirm, and only in the company-wide view (no deptId
  // scoping) — a leader's "Ranking de mi equipo" never shows this.
  const canConfirm = session!.user.role === "admin";
  const confirmedPodium = await prisma.monthlyRecognitionResult.findMany({
    where: { month },
    include: { user: { select: { name: true, photoUrl: true } } },
    orderBy: { rank: "asc" },
  });

  return NextResponse.json({
    month,
    maxTotalScore: MAX_TOTAL_SCORE,
    ranked,
    months,
    canConfirm,
    confirmedPodium: confirmedPodium.map((p) => ({ rank: p.rank, userId: p.userId, name: p.user.name, photoUrl: p.user.photoUrl, totalScore: p.totalScore })),
  });
}
