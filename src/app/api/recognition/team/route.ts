import { NextResponse } from "next/server";
import { auth } from "@/auth";
import { prisma } from "@/lib/prisma";
import { canAccessRecognition } from "@/lib/guards";
import { currentMonth, MAX_TOTAL_SCORE } from "@/lib/recognition";

// Who the current user evaluates this month, and whether each of them
// already has a submitted evaluation — admin evaluates leaders, a leader
// evaluates their own non-leader team.
export async function GET() {
  const canAccess = await canAccessRecognition();
  if (!canAccess) return NextResponse.json({ error: "No autorizado." }, { status: 403 });

  const session = await auth();
  const month = currentMonth();

  let evaluatees: { id: string; name: string; photoUrl: string | null; position: string | null; department: { name: string } | null }[];

  if (session!.user.role === "admin") {
    evaluatees = await prisma.user.findMany({
      where: { isLeader: true },
      select: { id: true, name: true, photoUrl: true, position: true, department: { select: { name: true } } },
      orderBy: { name: "asc" },
    });
  } else {
    const me = await prisma.user.findUnique({
      where: { id: session!.user.id },
      select: { isLeader: true, leadsDeptId: true },
    });
    if (!me?.isLeader || !me.leadsDeptId) {
      return NextResponse.json({ month, maxTotalScore: MAX_TOTAL_SCORE, people: [] });
    }
    evaluatees = await prisma.user.findMany({
      where: { deptId: me.leadsDeptId, isLeader: false },
      select: { id: true, name: true, photoUrl: true, position: true, department: { select: { name: true } } },
      orderBy: { name: "asc" },
    });
  }

  const evaluations = await prisma.monthlyEvaluation.findMany({
    where: { month, evaluateeId: { in: evaluatees.map((u) => u.id) } },
    select: { evaluateeId: true },
  });
  const doneIds = new Set(evaluations.map((e) => e.evaluateeId));

  return NextResponse.json({
    month,
    maxTotalScore: MAX_TOTAL_SCORE,
    people: evaluatees.map((u) => ({
      id: u.id,
      name: u.name,
      photoUrl: u.photoUrl,
      position: u.position,
      deptName: u.department?.name ?? null,
      done: doneIds.has(u.id),
    })),
  });
}
