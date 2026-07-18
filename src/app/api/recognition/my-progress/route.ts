import { NextResponse } from "next/server";
import { auth } from "@/auth";
import { prisma } from "@/lib/prisma";
import { rankEvaluations, rankSummaries, MAX_TOTAL_SCORE } from "@/lib/recognition";

// Every employee's own evaluation history, month by month — their total
// score, the pillar breakdown, and where they ranked that month (computed
// against the full company-wide ranking for that month, not just their
// department). Months still inside the retention window include the
// leader's comment and question detail; older, purged months only have the
// permanent summary (no comment/detail, same accurate total and rank).
export async function GET() {
  const session = await auth();
  if (!session || session.user.role !== "employee") return NextResponse.json({ error: "No autorizado." }, { status: 403 });

  const [detailedMonths, summaryMonths] = await Promise.all([
    prisma.monthlyEvaluation.findMany({ where: { evaluateeId: session.user.id }, select: { month: true } }),
    prisma.monthlyEvaluationSummary.findMany({ where: { evaluateeId: session.user.id }, select: { month: true } }),
  ]);
  const months = [...new Set([...detailedMonths.map((m) => m.month), ...summaryMonths.map((m) => m.month)])].sort();

  const history = [];
  for (const month of months) {
    const detailedEvaluations = await prisma.monthlyEvaluation.findMany({
      where: { month },
      include: {
        scores: { select: { pillar: true, questionId: true, score: true } },
        evaluatee: { select: { id: true, name: true, photoUrl: true, isLeader: true, department: { select: { name: true } } } },
      },
    });

    const ranked =
      detailedEvaluations.length > 0
        ? rankEvaluations(detailedEvaluations.map((e) => ({ ...e, evaluatee: e.evaluatee! })))
        : rankSummaries(
            (
              await prisma.monthlyEvaluationSummary.findMany({
                where: { month },
                include: { evaluatee: { select: { id: true, name: true, photoUrl: true, isLeader: true, department: { select: { name: true } } } } },
              })
            ).map((s) => ({ ...s, evaluatee: s.evaluatee! }))
          );

    const mine = ranked.find((r) => r.userId === session.user.id);
    if (mine) history.push({ month, ...mine, outOf: ranked.length });
  }

  return NextResponse.json({ history, maxTotalScore: MAX_TOTAL_SCORE });
}
