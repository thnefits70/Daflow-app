// Server-only (prisma) helpers for the admin confirmation step — kept out of
// recognition.ts for the same reason as recognitionPurge.ts: that file is
// imported by a "use client" component, and bundling prisma into it breaks
// the Turbopack client build.
import { prisma } from "@/lib/prisma";
import { averageQuestionScores, currentMonth, evaluationDeadline, pillarTotalsFromScores, rankEvaluations, rankSummaries } from "@/lib/recognition";

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

/**
 * ---------------- Feedback de Liderazgo 360° ----------------
 * Ver el comentario en schema.prisma sobre LeaderTeamFeedback para el
 * contexto completo. Este bloque vive acá (no en recognition.ts) por la
 * misma razón que el resto del archivo: toca prisma directamente.
 */

// Mismo filtro de cohort que ya usan pendingTasks.ts y
// area/colaborador-destacado/page.tsx — se calcula siempre dinámico, nunca
// hardcodeado por área, porque hoy Marketing/Finanzas no tienen equipo y eso
// puede cambiar.
export async function leaderHasTeam(leaderId: string): Promise<boolean> {
  const leader = await prisma.user.findUnique({ where: { id: leaderId }, select: { leadsDeptId: true } });
  if (!leader?.leadsDeptId) return false;
  const count = await prisma.user.count({
    where: { deptId: leader.leadsDeptId, isLeader: false, isActive: true, excludeFromRecognition: false },
  });
  return count > 0;
}

export async function computeTeamLiderazgoScore(leaderId: string, month: string): Promise<number> {
  const rows = await prisma.leaderTeamFeedbackScore.findMany({
    where: { feedback: { leaderId, month } },
    select: { questionId: true, score: true },
  });
  return averageQuestionScores(rows);
}

// Recalcula el resumen mensual de un líder mezclando los 6 pilares que sigue
// calificando el admin (leídos del detalle si todavía existe, o del resumen
// ya guardado si no) con el Liderazgo agregado del equipo. Se llama tanto
// cuando el admin guarda su evaluación como cada vez que un miembro del
// equipo envía/actualiza su calificación — así el ranking del admin siempre
// está al día, aunque el líder evaluado no vea nada hasta que se confirme el
// podio (ver isMonthConfirmed()).
export async function recomputeLeaderSummary(leaderId: string, month: string): Promise<void> {
  const detail = await prisma.monthlyEvaluation.findUnique({
    where: { month_evaluateeId: { month, evaluateeId: leaderId } },
    include: { scores: { select: { pillar: true, score: true } } },
  });

  let other6: Record<string, number>;
  if (detail) {
    const totals = pillarTotalsFromScores(detail.scores);
    other6 = {
      resultadosScore: totals.resultados,
      excelenciaScore: totals.excelencia,
      compromisoScore: totals.compromiso,
      colaboracionScore: totals.colaboracion,
      clienteScore: totals.orientacion_cliente,
      innovacionScore: totals.innovacion,
    };
  } else {
    const existing = await prisma.monthlyEvaluationSummary.findUnique({ where: { month_evaluateeId: { month, evaluateeId: leaderId } } });
    other6 = {
      resultadosScore: existing?.resultadosScore ?? 0,
      excelenciaScore: existing?.excelenciaScore ?? 0,
      compromisoScore: existing?.compromisoScore ?? 0,
      colaboracionScore: existing?.colaboracionScore ?? 0,
      clienteScore: existing?.clienteScore ?? 0,
      innovacionScore: existing?.innovacionScore ?? 0,
    };
  }

  const liderazgoScore = await computeTeamLiderazgoScore(leaderId, month);
  const totalScore = Object.values(other6).reduce((a, b) => a + b, 0) + liderazgoScore;

  const fields = {
    resultadosScore: other6.resultadosScore,
    excelenciaScore: other6.excelenciaScore,
    compromisoScore: other6.compromisoScore,
    colaboracionScore: other6.colaboracionScore,
    clienteScore: other6.clienteScore,
    innovacionScore: other6.innovacionScore,
    liderazgoScore,
    totalScore,
  };
  await prisma.monthlyEvaluationSummary.upsert({
    where: { month_evaluateeId: { month, evaluateeId: leaderId } },
    create: { month, evaluateeId: leaderId, ...fields },
    update: fields,
  });
}

// "Se cerró el mes" = ya se confirmó el podio de Colaborador Destacado para
// ese mes (la misma acción deliberada de un clic que ya existe) — hasta
// entonces, nada de feedback de equipo/observaciones/comentarios se le
// muestra a quien lo recibe.
export async function isMonthConfirmed(month: string): Promise<boolean> {
  const row = await prisma.monthlyRecognitionResult.findFirst({ where: { month } });
  return !!row;
}
