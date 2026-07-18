import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { auth } from "@/auth";
import { prisma } from "@/lib/prisma";
import { canEvaluateUser } from "@/lib/guards";
import { PILLARS, pickQuestions, currentMonth, QUESTIONS_PER_PILLAR } from "@/lib/recognition";

// Returns this month's randomized question set for (evaluator, evaluatee),
// grouped by pillar, plus any scores/comment already saved (so reopening a
// half-finished evaluation resumes where it left off — the question
// selection is deterministic per evaluator+evaluatee+month, so it never
// reshuffles between loads).
export async function GET(req: NextRequest) {
  const session = await auth();
  if (!session) return NextResponse.json({ error: "No autorizado." }, { status: 403 });

  const evaluateeId = req.nextUrl.searchParams.get("evaluateeId");
  if (!evaluateeId) return NextResponse.json({ error: "Falta evaluateeId." }, { status: 400 });

  const canEvaluate = await canEvaluateUser(evaluateeId);
  if (!canEvaluate) return NextResponse.json({ error: "No autorizado." }, { status: 403 });

  const month = currentMonth();
  const evaluatorId = session.user.role === "admin" ? "admin" : session.user.id;

  const existing = await prisma.monthlyEvaluation.findUnique({
    where: { month_evaluateeId: { month, evaluateeId } },
    include: { scores: true },
  });

  const pillars = PILLARS.map((p) => ({
    ...p,
    questions: pickQuestions(evaluatorId, evaluateeId, month, p.key).map((q) => ({
      ...q,
      score: existing?.scores.find((s) => s.questionId === q.id)?.score ?? null,
    })),
  }));

  return NextResponse.json({
    month,
    pillars,
    comment: existing?.comment ?? "",
    questionsPerPillar: QUESTIONS_PER_PILLAR,
  });
}

const submitSchema = z.object({
  evaluateeId: z.string().min(1),
  scores: z
    .array(
      z.object({
        pillar: z.string().min(1),
        questionId: z.string().min(1),
        score: z.number().int().min(1).max(5),
      })
    )
    .min(1),
  comment: z.string().trim().max(600).optional(),
});

export async function POST(req: NextRequest) {
  const session = await auth();
  if (!session) return NextResponse.json({ error: "No autorizado." }, { status: 403 });

  const body = await req.json().catch(() => null);
  const parsed = submitSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.issues[0]?.message ?? "Datos inválidos." }, { status: 400 });
  }
  const { evaluateeId, scores, comment } = parsed.data;

  const canEvaluate = await canEvaluateUser(evaluateeId);
  if (!canEvaluate) return NextResponse.json({ error: "No autorizado." }, { status: 403 });

  // Every question in every pillar must be answered — a partial evaluation
  // would give this person an unfair (lower max) total against everyone
  // else, which breaks the ranking's fairness.
  const expectedCount = PILLARS.length * QUESTIONS_PER_PILLAR;
  if (scores.length !== expectedCount) {
    return NextResponse.json({ error: "Debes responder todas las preguntas antes de guardar." }, { status: 400 });
  }

  const month = currentMonth();
  const evaluatorId = session.user.role === "admin" ? "admin" : session.user.id;

  const evaluation = await prisma.$transaction(async (tx) => {
    const ev = await tx.monthlyEvaluation.upsert({
      where: { month_evaluateeId: { month, evaluateeId } },
      create: { month, evaluateeId, evaluatorId, comment: comment || null },
      update: { evaluatorId, comment: comment || null },
    });
    await tx.monthlyEvaluationScore.deleteMany({ where: { evaluationId: ev.id } });
    await tx.monthlyEvaluationScore.createMany({
      data: scores.map((s) => ({ evaluationId: ev.id, pillar: s.pillar, questionId: s.questionId, score: s.score })),
    });
    return ev;
  });

  return NextResponse.json({ ok: true, id: evaluation.id });
}
