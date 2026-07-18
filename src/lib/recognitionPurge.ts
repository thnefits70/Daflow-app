// Kept separate from recognition.ts (which is imported by a "use client"
// component for PILLARS/etc.) because this needs prisma, and bundling
// prisma into a client component blows up Turbopack ("node:module" is not
// supported in the browser chunk).
import { prisma } from "@/lib/prisma";
import { retentionCutoffMonth, summaryFieldsFromScores } from "@/lib/recognition";

// Deletes the detailed MonthlyEvaluation (+ cascaded MonthlyEvaluationScore)
// rows for any month older than the retention window, after making sure
// each one has a MonthlyEvaluationSummary to survive it (normally already
// written at submission time — this upsert is just a safety net). Called
// opportunistically whenever a new evaluation is submitted, since this app
// has no separate cron/background-job infrastructure — evaluations happen
// often enough (monthly, per leader) that this keeps the detailed table
// from ever growing past ~3 months of data without needing one.
export async function purgeOldEvaluationDetail(): Promise<number> {
  const cutoff = retentionCutoffMonth();
  const old = await prisma.monthlyEvaluation.findMany({
    where: { month: { lt: cutoff } },
    include: { scores: { select: { pillar: true, score: true } } },
  });
  if (old.length === 0) return 0;

  for (const ev of old) {
    await prisma.monthlyEvaluationSummary.upsert({
      where: { month_evaluateeId: { month: ev.month, evaluateeId: ev.evaluateeId } },
      create: { month: ev.month, evaluateeId: ev.evaluateeId, ...summaryFieldsFromScores(ev.scores) },
      update: {},
    });
  }
  const res = await prisma.monthlyEvaluation.deleteMany({ where: { id: { in: old.map((e) => e.id) } } });
  return res.count;
}
