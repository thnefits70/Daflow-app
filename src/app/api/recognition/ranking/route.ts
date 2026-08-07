import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/auth";
import { prisma } from "@/lib/prisma";
import { canAccessRecognition } from "@/lib/guards";
import { currentMonth, rankEvaluations, rankSummaries, MAX_TOTAL_SCORE } from "@/lib/recognition";

// Admin sees the full company-wide ranking (optionally filtered to one
// department); a leader only sees their own team's ranking — one combined
// list mixing leaders and regular employees together, since the title is
// company-wide, not per-department. A month still inside the retention
// window is ranked from the detailed evaluations (drill-down available);
// once purged, it falls back to the permanent summary rows (no drill-down,
// same exact ranking).
export async function GET(req: NextRequest) {
  const canAccess = await canAccessRecognition();
  if (!canAccess) return NextResponse.json({ error: "No autorizado." }, { status: 403 });

  const session = await auth();
  const deptId = req.nextUrl.searchParams.get("deptId");

  let scopedEvaluateeWhere: { deptId: string; isLeader?: boolean } | undefined = deptId ? { deptId } : undefined;
  if (session!.user.role !== "admin") {
    const me = await prisma.user.findUnique({
      where: { id: session!.user.id },
      select: { isLeader: true, leadsDeptId: true },
    });
    if (!me?.isLeader || !me.leadsDeptId) {
      return NextResponse.json({ month: currentMonth(), maxTotalScore: MAX_TOTAL_SCORE, ranked: [], months: [], canConfirm: false, confirmedPodium: [] });
    }
    // Only the leader's team, never the leader themselves — their own
    // deptId matches leadsDeptId, so this must be excluded explicitly or
    // they'd show up ranked inside their own team's list.
    scopedEvaluateeWhere = { deptId: me.leadsDeptId, isLeader: false };
  }

  const evaluateeFilter = scopedEvaluateeWhere ? { evaluatee: scopedEvaluateeWhere } : {};
  const [detailedMonths, summaryMonths] = await Promise.all([
    prisma.monthlyEvaluation.findMany({ where: evaluateeFilter, distinct: ["month"], select: { month: true } }),
    prisma.monthlyEvaluationSummary.findMany({ where: evaluateeFilter, distinct: ["month"], select: { month: true } }),
  ]);
  const months = [...new Set([...detailedMonths.map((m) => m.month), ...summaryMonths.map((m) => m.month)])].sort().reverse();

  // Respect an explicit choice from the month dropdown as-is. On first load
  // (no param), default to the most recent month that actually has data
  // instead of always the calendar's current month — otherwise, right after
  // this feature launches or whenever the current month hasn't been
  // evaluated yet, the dropdown would visually show one month while quietly
  // querying an empty different one.
  const monthParam = req.nextUrl.searchParams.get("month");
  const month = monthParam ?? months[0] ?? currentMonth();

  const detailedEvaluations = await prisma.monthlyEvaluation.findMany({
    where: { month, ...(scopedEvaluateeWhere ? { evaluatee: scopedEvaluateeWhere } : {}) },
    include: {
      scores: { select: { pillar: true, questionId: true, score: true } },
      evaluatee: { select: { id: true, name: true, photoUrl: true, isLeader: true, department: { select: { name: true } } } },
    },
  });

  let ranked;
  let evaluatedUserIds: string[];
  if (detailedEvaluations.length > 0) {
    ranked = rankEvaluations(detailedEvaluations.map((e) => ({ ...e, evaluatee: e.evaluatee! })));
    evaluatedUserIds = detailedEvaluations.map((e) => e.evaluateeId);
  } else {
    const summaries = await prisma.monthlyEvaluationSummary.findMany({
      where: { month, ...(scopedEvaluateeWhere ? { evaluatee: scopedEvaluateeWhere } : {}) },
      include: { evaluatee: { select: { id: true, name: true, photoUrl: true, isLeader: true, department: { select: { name: true } } } } },
    });
    ranked = rankSummaries(summaries.map((s) => ({ ...s, evaluatee: s.evaluatee! })));
    evaluatedUserIds = summaries.map((s) => s.evaluateeId);
  }

  // Confirmado 2026-08-06: el podio es de TODA la empresa, así que solo tiene
  // sentido confirmarlo en la vista general (sin filtrar por área) — y solo
  // cuando cada colaborador y líder activo YA tiene su evaluación de este
  // mes registrada. Antes canConfirm solo miraba el rol, así que el botón
  // aparecía aunque faltara gente por calificar; ahora se bloquea y se
  // muestra cuántos faltan, en vez de dejar confirmar un podio incompleto.
  const isCompanyWideAdminView = session!.user.role === "admin" && !deptId;
  let missingCount = 0;
  let totalEligible = 0;
  if (isCompanyWideAdminView) {
    // Mismo criterio ya usado por el aviso de Pendientes (getMissingEvaluatees
    // en pendingTasks.ts): todo activo sin excludeFromRecognition cuenta,
    // sea líder (lo evalúa el admin) o no (lo evalúa el líder de su área) —
    // excludeFromRecognition es el flag permanente de Nómina (ej. Dexi
    // Villafuerte), esas personas nunca cuentan como "pendientes".
    const eligibleUsers = await prisma.user.findMany({ where: { isActive: true, excludeFromRecognition: false }, select: { id: true } });
    totalEligible = eligibleUsers.length;
    const evaluatedSet = new Set(evaluatedUserIds);
    missingCount = eligibleUsers.filter((u) => !evaluatedSet.has(u.id)).length;
  }
  const canConfirm = isCompanyWideAdminView && totalEligible > 0 && missingCount === 0;

  const confirmedPodium = await prisma.monthlyRecognitionResult.findMany({
    where: { month },
    include: { user: { select: { name: true, photoUrl: true } } },
    orderBy: { rank: "asc" },
  });

  return NextResponse.json({
    month,
    maxTotalScore: MAX_TOTAL_SCORE,
    ranked,
    months,
    canConfirm,
    missingCount,
    totalEligible,
    confirmedPodium: confirmedPodium.map((p) => ({ rank: p.rank, userId: p.userId, name: p.user.name, photoUrl: p.user.photoUrl, totalScore: p.totalScore })),
  });
}
