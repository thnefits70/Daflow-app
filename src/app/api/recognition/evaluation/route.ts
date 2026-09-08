import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { auth } from "@/auth";
import { prisma } from "@/lib/prisma";
import { canEvaluateUser } from "@/lib/guards";
import { PILLARS, pickQuestions, currentMonth, QUESTIONS_PER_PILLAR, summaryFieldsFromScores } from "@/lib/recognition";
import { purgeOldEvaluationDetail } from "@/lib/recognitionPurge";
import { getEarliestIncompleteMonthBefore, formatMonthLabel } from "@/lib/pendingTasks";
import { leaderHasTeam, recomputeLeaderSummary } from "@/lib/recognitionAdmin";

// Un líder cuyo equipo lo califica en Liderazgo 360° ya no responde ese pilar
// acá — ver el bloque "Feedback de Liderazgo 360°" en recognitionAdmin.ts.
async function liderazgoSourceFor(evaluateeId: string, evaluateeIsLeader: boolean): Promise<"team" | "admin"> {
  if (!evaluateeIsLeader) return "admin";
  return (await leaderHasTeam(evaluateeId)) ? "team" : "admin";
}

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

  // Normally always the current month — a month query param is only used
  // when catching up a past month (e.g. right after this feature launched
  // and June never got evaluated), never a future one.
  const monthParam = req.nextUrl.searchParams.get("month");
  const month = monthParam && /^\d{4}-\d{2}$/.test(monthParam) && monthParam <= currentMonth() ? monthParam : currentMonth();
  const evaluatorId = session.user.role === "admin" ? "admin" : session.user.id;

  // Confirmado 2026-08-07: metodología estricta mes por mes — si todavía
  // queda gente sin calificar de un mes anterior, se avisa acá (antes de
  // cargar las preguntas) en vez de dejar que llene todo el formulario y
  // recién se entere al guardar.
  const isAdmin = session.user.role === "admin";
  const evaluatee = await prisma.user.findUnique({ where: { id: evaluateeId }, select: { deptId: true, isLeader: true } });
  if (!evaluatee) return NextResponse.json({ error: "No autorizado." }, { status: 403 });
  const evaluateeDept = isAdmin ? null : evaluatee;
  const blocked = await getEarliestIncompleteMonthBefore(isAdmin, evaluateeDept?.deptId ?? null, month);
  if (blocked) {
    return NextResponse.json(
      {
        error: `Antes de calificar ${formatMonthLabel(month)}, completa primero ${formatMonthLabel(blocked.month)} — todavía falta calificar a ${blocked.missingNames.join(", ")}.`,
        blockedMonth: blocked.month,
      },
      { status: 409 }
    );
  }

  const liderazgoSource = await liderazgoSourceFor(evaluateeId, evaluatee.isLeader);

  const existing = await prisma.monthlyEvaluation.findUnique({
    where: { month_evaluateeId: { month, evaluateeId } },
    include: { scores: true },
  });

  const pillars = PILLARS.filter((p) => p.key !== "liderazgo" || liderazgoSource === "admin").map((p) => ({
    ...p,
    questions: pickQuestions(evaluatorId, evaluateeId, month, p.key).map((q) => ({
      ...q,
      score: existing?.scores.find((s) => s.questionId === q.id)?.score ?? null,
    })),
  }));

  return NextResponse.json({
    month,
    pillars,
    liderazgoSource,
    comment: existing?.comment ?? "",
    questionsPerPillar: QUESTIONS_PER_PILLAR,
  });
}

const submitSchema = z.object({
  evaluateeId: z.string().min(1),
  month: z.string().regex(/^\d{4}-\d{2}$/).optional(),
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

  const evaluatee = await prisma.user.findUnique({ where: { id: evaluateeId }, select: { deptId: true, isLeader: true } });
  if (!evaluatee) return NextResponse.json({ error: "No autorizado." }, { status: 403 });
  const liderazgoSource = await liderazgoSourceFor(evaluateeId, evaluatee.isLeader);

  // Every question in every pillar must be answered — a partial evaluation
  // would give this person an unfair (lower max) total against everyone
  // else, which breaks the ranking's fairness. Un líder cuyo Liderazgo lo
  // califica su equipo no responde ese pilar acá (24 en vez de 28), y ningún
  // score de "liderazgo" puede colarse en ese caso.
  const expectedPillars = liderazgoSource === "team" ? PILLARS.length - 1 : PILLARS.length;
  const expectedCount = expectedPillars * QUESTIONS_PER_PILLAR;
  if (scores.length !== expectedCount) {
    return NextResponse.json({ error: "Debes responder todas las preguntas antes de guardar." }, { status: 400 });
  }
  if (liderazgoSource === "team" && scores.some((s) => s.pillar === "liderazgo")) {
    return NextResponse.json({ error: "Este pilar lo califica el equipo, no se puede enviar acá." }, { status: 400 });
  }

  // Same "past month only, never future" rule as GET — catching up a month
  // this feature didn't exist for yet, not backdating around the deadline.
  const month = parsed.data.month && parsed.data.month <= currentMonth() ? parsed.data.month : currentMonth();
  const evaluatorId = session.user.role === "admin" ? "admin" : session.user.id;

  // Defensa server-side del mismo bloqueo que ya avisó el GET — por si
  // alguien deja el formulario abierto desde antes y guarda después de que
  // otro mes anterior quedó pendiente, o llama a la API directo.
  const isAdmin = session.user.role === "admin";
  const evaluateeDept = isAdmin ? null : evaluatee;
  const blocked = await getEarliestIncompleteMonthBefore(isAdmin, evaluateeDept?.deptId ?? null, month);
  if (blocked) {
    return NextResponse.json(
      {
        error: `Antes de calificar ${formatMonthLabel(month)}, completa primero ${formatMonthLabel(blocked.month)} — todavía falta calificar a ${blocked.missingNames.join(", ")}.`,
        blockedMonth: blocked.month,
      },
      { status: 409 }
    );
  }

  const summaryFields = summaryFieldsFromScores(scores);

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
    // Written alongside the detailed evaluation, not just at purge time, so
    // the ranking/trend never depend on the detailed row still existing.
    await tx.monthlyEvaluationSummary.upsert({
      where: { month_evaluateeId: { month, evaluateeId } },
      create: { month, evaluateeId, ...summaryFields },
      update: summaryFields,
    });
    return ev;
  });

  // El upsert de arriba dejó liderazgoScore en 0 (summaryFieldsFromScores no
  // recibió ninguna pregunta de ese pilar) — se completa con lo que ya haya
  // enviado el equipo.
  if (liderazgoSource === "team") {
    await recomputeLeaderSummary(evaluateeId, month);
  }

  // No cron in this app — piggyback the retention cleanup on the natural
  // write cadence (a handful of evaluations per month) instead.
  await purgeOldEvaluationDetail();

  return NextResponse.json({ ok: true, id: evaluation.id });
}
