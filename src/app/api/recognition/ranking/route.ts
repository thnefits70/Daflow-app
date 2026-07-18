import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/auth";
import { prisma } from "@/lib/prisma";
import { canAccessRecognition } from "@/lib/guards";
import { currentMonth, rankEvaluations, MAX_TOTAL_SCORE } from "@/lib/recognition";

// Admin sees the full company-wide ranking (optionally filtered to one
// department); a leader only sees their own team's ranking — one combined
// list mixing leaders and regular employees together, since the title is
// company-wide, not per-department.
export async function GET(req: NextRequest) {
  const canAccess = await canAccessRecognition();
  if (!canAccess) return NextResponse.json({ error: "No autorizado." }, { status: 403 });

  const session = await auth();
  const month = req.nextUrl.searchParams.get("month") ?? currentMonth();
  const deptId = req.nextUrl.searchParams.get("deptId");

  const where: { month: string; evaluatee?: { deptId: string; isLeader?: boolean } } = { month };
  if (session!.user.role === "admin") {
    if (deptId) where.evaluatee = { deptId };
  } else {
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
    where.evaluatee = { deptId: me.leadsDeptId, isLeader: false };
  }

  const evaluations = await prisma.monthlyEvaluation.findMany({
    where,
    include: {
      scores: { select: { pillar: true, questionId: true, score: true } },
      evaluatee: { select: { id: true, name: true, photoUrl: true, isLeader: true, department: { select: { name: true } } } },
    },
  });
  const ranked = rankEvaluations(evaluations.map((e) => ({ ...e, evaluatee: e.evaluatee! })));

  const monthRows = await prisma.monthlyEvaluation.findMany({
    where: session!.user.role === "admin" ? {} : { evaluatee: where.evaluatee },
    distinct: ["month"],
    select: { month: true },
    orderBy: { month: "desc" },
  });

  return NextResponse.json({ month, maxTotalScore: MAX_TOTAL_SCORE, ranked, months: monthRows.map((m) => m.month) });
}
