import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { auth } from "@/auth";
import { prisma } from "@/lib/prisma";
import { currentMonth, pickLeadershipQuestions, findLeadershipQuestionText } from "@/lib/recognition";
import { isMonthConfirmed } from "@/lib/recognitionAdmin";

// Feedback privado del admin (ver AdminLeadershipFeedback en schema.prisma):
// nunca toca el ranking de Colaborador del Mes. Esta ruta hace doble uso:
// - admin: lee el tablero privado (por mes ya confirmado, con nombres reales).
// - un líder: envía/edita su propia calificación al admin este mes.
const ADMIN_TARGET_ID = "admin";

export async function GET(req: NextRequest) {
  const session = await auth();
  if (!session) return NextResponse.json({ error: "No autorizado." }, { status: 403 });

  if (session.user.role === "admin") {
    const monthParam = req.nextUrl.searchParams.get("month");
    let month = monthParam && /^\d{4}-\d{2}$/.test(monthParam) && (await isMonthConfirmed(monthParam)) ? monthParam : null;
    if (!month) {
      const latestConfirmed = await prisma.monthlyRecognitionResult.findFirst({ orderBy: { month: "desc" }, select: { month: true } });
      month = latestConfirmed?.month ?? null;
    }
    if (!month) return NextResponse.json({ month: null, leaderEntries: [], observations: [] });

    const [feedbackRows, observationRows] = await Promise.all([
      prisma.adminLeadershipFeedback.findMany({ where: { month }, include: { scores: true } }),
      prisma.adminLeadershipObservation.findMany({ where: { month } }),
    ]);
    const peopleIds = [...feedbackRows.map((r) => r.evaluatorId), ...observationRows.map((r) => r.observerId)];
    const people = await prisma.user.findMany({ where: { id: { in: peopleIds } }, select: { id: true, name: true, photoUrl: true } });
    const byId = new Map(people.map((p) => [p.id, p]));

    return NextResponse.json({
      month,
      leaderEntries: feedbackRows.map((r) => ({
        evaluatorId: r.evaluatorId,
        evaluatorName: byId.get(r.evaluatorId)?.name ?? "—",
        photoUrl: byId.get(r.evaluatorId)?.photoUrl ?? null,
        score: r.scores.reduce((a, s) => a + s.score, 0),
        answers: r.scores.map((s) => ({ questionText: findLeadershipQuestionText(s.questionId), score: s.score })),
        positiveComment: r.positiveComment,
        improvementComment: r.improvementComment,
      })),
      observations: observationRows.map((r) => ({
        observerId: r.observerId,
        observerName: byId.get(r.observerId)?.name ?? "—",
        photoUrl: byId.get(r.observerId)?.photoUrl ?? null,
        positiveComment: r.positiveComment,
        improvementComment: r.improvementComment,
      })),
    });
  }

  const me = await prisma.user.findUnique({ where: { id: session.user.id }, select: { isLeader: true } });
  if (!me?.isLeader) return NextResponse.json({ error: "No autorizado." }, { status: 403 });

  const month = currentMonth();
  const existing = await prisma.adminLeadershipFeedback.findUnique({
    where: { month_evaluatorId: { month, evaluatorId: session.user.id } },
    include: { scores: true },
  });

  const questions = pickLeadershipQuestions(ADMIN_TARGET_ID, month).map((q) => ({
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
  scores: z.array(z.object({ questionId: z.string().min(1), score: z.number().int().min(1).max(5) })).min(1),
  positiveComment: z.string().trim().min(3, "Contanos algo positivo primero.").max(600),
  improvementComment: z.string().trim().max(600).optional(),
});

export async function POST(req: NextRequest) {
  const session = await auth();
  if (!session || session.user.role !== "employee") return NextResponse.json({ error: "No autorizado." }, { status: 403 });

  const me = await prisma.user.findUnique({ where: { id: session.user.id }, select: { isLeader: true } });
  if (!me?.isLeader) return NextResponse.json({ error: "No autorizado." }, { status: 403 });

  const body = await req.json().catch(() => null);
  const parsed = submitSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.issues[0]?.message ?? "Datos inválidos." }, { status: 400 });
  }
  const { scores, positiveComment, improvementComment } = parsed.data;

  const month = currentMonth();
  const validIds = new Set(pickLeadershipQuestions(ADMIN_TARGET_ID, month).map((q) => q.id));
  if (scores.length !== validIds.size || scores.some((s) => !validIds.has(s.questionId))) {
    return NextResponse.json({ error: "Las preguntas no coinciden con las de este mes — recarga la página." }, { status: 400 });
  }

  await prisma.$transaction(async (tx) => {
    const fb = await tx.adminLeadershipFeedback.upsert({
      where: { month_evaluatorId: { month, evaluatorId: session.user.id } },
      create: { month, evaluatorId: session.user.id, positiveComment, improvementComment: improvementComment || null },
      update: { positiveComment, improvementComment: improvementComment || null },
    });
    await tx.adminLeadershipFeedbackScore.deleteMany({ where: { feedbackId: fb.id } });
    await tx.adminLeadershipFeedbackScore.createMany({
      data: scores.map((s) => ({ feedbackId: fb.id, questionId: s.questionId, score: s.score })),
    });
  });

  return NextResponse.json({ ok: true });
}
