import { NextResponse } from "next/server";
import { auth } from "@/auth";
import { prisma } from "@/lib/prisma";
import { rankEvaluations, MAX_TOTAL_SCORE } from "@/lib/recognition";

// Every employee's own evaluation history, month by month — their total
// score, the pillar breakdown, their leader's comment, and where they
// ranked that month (computed against the full company-wide ranking for
// that month, not just their department) — meant as growth feedback, not
// just a number.
export async function GET() {
  const session = await auth();
  if (!session || session.user.role !== "employee") return NextResponse.json({ error: "No autorizado." }, { status: 403 });

  const myEvaluations = await prisma.monthlyEvaluation.findMany({
    where: { evaluateeId: session.user.id },
    select: { month: true },
    orderBy: { month: "asc" },
  });

  const history = [];
  for (const { month } of myEvaluations) {
    const monthEvaluations = await prisma.monthlyEvaluation.findMany({
      where: { month },
      include: {
        scores: { select: { pillar: true, questionId: true, score: true } },
        evaluatee: { select: { id: true, name: true, photoUrl: true, isLeader: true, department: { select: { name: true } } } },
      },
    });
    const ranked = rankEvaluations(monthEvaluations.map((e) => ({ ...e, evaluatee: e.evaluatee! })));
    const mine = ranked.find((r) => r.userId === session.user.id);
    if (mine) history.push({ month, ...mine, outOf: ranked.length });
  }

  return NextResponse.json({ history, maxTotalScore: MAX_TOTAL_SCORE });
}
