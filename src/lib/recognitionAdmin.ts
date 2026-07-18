// Server-only (prisma) helpers for the admin confirmation step — kept out of
// recognition.ts for the same reason as recognitionPurge.ts: that file is
// imported by a "use client" component, and bundling prisma into it breaks
// the Turbopack client build.
import { prisma } from "@/lib/prisma";
import { currentMonth, evaluationDeadline, rankEvaluations, rankSummaries } from "@/lib/recognition";

// The most recent month whose evaluation window has closed, has at least
// one evaluation, and hasn't been confirmed yet — this is what the admin's
// sidebar badge and notification point at. Checks the current month and the
// previous one, which covers every realistic case (a month closes either at
// its own end or a day or two into the next one).
export async function getMonthPendingConfirmation(): Promise<string | null> {
  const now = new Date();
  const cur = currentMonth();
  const prevDate = new Date(now.getFullYear(), now.getMonth() - 1, 1);
  const prev = `${prevDate.getFullYear()}-${String(prevDate.getMonth() + 1).padStart(2, "0")}`;

  for (const month of [cur, prev]) {
    if (now < evaluationDeadline(month)) continue;
    const alreadyConfirmed = await prisma.monthlyRecognitionResult.findFirst({ where: { month } });
    if (alreadyConfirmed) continue;
    const hasEvaluations = await prisma.monthlyEvaluationSummary.findFirst({ where: { month } });
    if (!hasEvaluations) continue;
    return month;
  }
  return null;
}

// Computes the month's ranking (from detail if still available, summary
// otherwise — same as the ranking API) and freezes the top 3 into
// MonthlyRecognitionResult. Re-confirming the same month replaces the
// previous podium rather than erroring, in case a leader's evaluation
// changed something before admin confirmed.
export async function confirmMonthWinner(month: string) {
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

  const podium = ranked.slice(0, 3);
  if (podium.length === 0) return null;

  await prisma.$transaction([
    prisma.monthlyRecognitionResult.deleteMany({ where: { month } }),
    ...podium.map((p) =>
      prisma.monthlyRecognitionResult.create({
        data: { month, rank: p.rank, userId: p.userId, totalScore: p.totalScore },
      })
    ),
  ]);

  return podium;
}
