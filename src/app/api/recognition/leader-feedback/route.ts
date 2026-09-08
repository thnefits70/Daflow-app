import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { auth } from "@/auth";
import { prisma } from "@/lib/prisma";
import { canRateLeaderLeadership } from "@/lib/guards";
import { currentMonth, pickLeadershipQuestions } from "@/lib/recognition";
import { recomputeLeaderSummary } from "@/lib/recognitionAdmin";

// Un miembro del equipo califica el Liderazgo de su propio líder este mes —
// ver el bloque "Feedback de Liderazgo 360°" en schema.prisma. Devuelve las
// mismas 4 preguntas (deterministas por líder+mes, sin evaluatorId) que
// verán todos sus compañeros, más lo que ya haya guardado esta persona.
export async function GET(req: NextRequest) {
  const session = await auth();
  if (!session) return NextResponse.json({ error: "No autorizado." }, { status: 403 });

  const leaderId = req.nextUrl.searchParams.get("leaderId");
  if (!leaderId) return NextResponse.json({ error: "Falta leaderId." }, { status: 400 });

  const canRate = await canRateLeaderLeadership(leaderId);
  if (!canRate) return NextResponse.json({ error: "No autorizado." }, { status: 403 });

  const month = currentMonth();
  const existing = await prisma.leaderTeamFeedback.findUnique({
    where: { month_leaderId_evaluatorId: { month, leaderId, evaluatorId: session.user.id } },
    include: { scores: true },
  });

  const questions = pickLeadershipQuestions(leaderId, month).map((q) => ({
    ...q,
    score: existing?.scores.find((s) => s.questionId === q.id)?.score ?? null,
  }));

  return NextResponse.json({
    month,
    questions,
    positiveComment: existing?.positiveComment ?? "",
    improvementComment: existing?.improvementComment ?? "",
    submitted: !!existing,
  });
}

const submitSchema = z.object({
  leaderId: z.string().min(1),
  scores: z.array(z.object({ questionId: z.string().min(1), score: z.number().int().min(1).max(5) })).min(1),
  positiveComment: z.string().trim().min(3, "Contanos algo positivo de tu líder.").max(600),
  improvementComment: z.string().trim().max(600).optional(),
});

export async function POST(req: NextRequest) {
  const session = await auth();
  if (!session) return NextResponse.json({ error: "No autorizado." }, { status: 403 });

  const body = await req.json().catch(() => null);
  const parsed = submitSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.issues[0]?.message ?? "Datos inválidos." }, { status: 400 });
  }
  const { leaderId, scores, positiveComment, improvementComment } = parsed.data;

  const canRate = await canRateLeaderLeadership(leaderId);
  if (!canRate) return NextResponse.json({ error: "No autorizado." }, { status: 403 });

  const month = currentMonth();
  const validIds = new Set(pickLeadershipQuestions(leaderId, month).map((q) => q.id));
  if (scores.length !== validIds.size || scores.some((s) => !validIds.has(s.questionId))) {
    return NextResponse.json({ error: "Las preguntas no coinciden con las de este mes — recarga la página." }, { status: 400 });
  }

  await prisma.$transaction(async (tx) => {
    const fb = await tx.leaderTeamFeedback.upsert({
      where: { month_leaderId_evaluatorId: { month, leaderId, evaluatorId: session.user.id } },
      create: { month, leaderId, evaluatorId: session.user.id, positiveComment, improvementComment: improvementComment || null },
      update: { positiveComment, improvementComment: improvementComment || null },
    });
    await tx.leaderTeamFeedbackScore.deleteMany({ where: { feedbackId: fb.id } });
    await tx.leaderTeamFeedbackScore.createMany({
      data: scores.map((s) => ({ feedbackId: fb.id, questionId: s.questionId, score: s.score })),
    });
  });

  await recomputeLeaderSummary(leaderId, month);

  return NextResponse.json({ ok: true });
}
