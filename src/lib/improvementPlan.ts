import { prisma } from "@/lib/prisma";
import { dbUserId } from "@/lib/guards";
import { notifyOwner } from "@/lib/notifications";
import type { Prisma } from "@/generated/prisma/client";
import type {
  ImprovementPlanCommitmentResponsible,
  ImprovementPlanOutcome,
  ImprovementPlanSemaforo,
  ImprovementPlanStage,
} from "@/generated/prisma/client";

// Re-exportado desde improvementPlanConstants.ts (sin imports de servidor)
// para que el código de servidor pueda seguir importándolo desde acá.
export { SUGGESTED_INDICATORS } from "@/lib/improvementPlanConstants";

const OUTCOME_LABEL: Record<ImprovementPlanOutcome, string> = {
  CONTINUIDAD: "Continuidad",
  REUBICACION: "Reubicación",
  REVISION_CONTINUIDAD: "Revisión de continuidad",
};

const STAGE_LABEL: Record<ImprovementPlanStage, string> = {
  PRIMER_PERIODO: "el Primer período de mejora",
  EXTENDIDO: "el período Extendido",
  ETAPA_FINAL: "la Etapa Final",
  CERRADO: "el cierre",
};

const DEFAULT_STAGE_DURATION_DAYS = 15;

export function computeAvgScore(scores: Record<string, number>): number {
  const values = Object.values(scores).filter((v) => Number.isFinite(v));
  if (values.length === 0) return 0;
  const avg = values.reduce((a, b) => a + b, 0) / values.length;
  return Math.round(avg * 100) / 100;
}

export function computeSemaforo(avg: number): ImprovementPlanSemaforo {
  if (avg >= 3.5) return "VERDE";
  if (avg >= 2.5) return "AMARILLO";
  if (avg >= 1.5) return "NARANJA";
  return "ROJO";
}

export function stageDeadlineFrom(start: Date, days: number): Date {
  return new Date(start.getTime() + days * 86400000);
}

const PLAN_INCLUDE = {
  collaborator: { select: { id: true, name: true } },
  leader: { select: { id: true, name: true } },
  dept: { select: { id: true, name: true } },
  pendingClosureRequestedBy: { select: { name: true } },
  adminApprovedBy: { select: { name: true } },
  commitments: { orderBy: { order: "asc" as const } },
  reviews: {
    orderBy: { weekOf: "desc" as const },
    include: { createdBy: { select: { name: true } } },
  },
};

type PlanRow = Prisma.ImprovementPlanGetPayload<{ include: typeof PLAN_INCLUDE }>;

export type ImprovementPlanCommitmentDTO = {
  id: string;
  indicador: string;
  meta: string;
  responsable: ImprovementPlanCommitmentResponsible;
  order: number;
};

export type ImprovementPlanReviewDTO = {
  id: string;
  weekOf: string;
  scores: Record<string, number>;
  avgScore: number;
  semaforo: ImprovementPlanSemaforo;
  queMejoro: string;
  queFalta: string;
  accionSiguiente: string;
  apoyoLider: string;
  aiAssisted: boolean;
  createdByName: string | null;
  createdAt: string;
};

export type ImprovementPlanSummaryDTO = {
  id: string;
  collaboratorId: string;
  collaboratorName: string;
  leaderId: string | null;
  leaderName: string | null;
  deptId: string;
  deptName: string;
  stage: ImprovementPlanStage;
  stageDeadline: string;
  outcome: ImprovementPlanOutcome | null;
  closedAt: string | null;
  latestSemaforo: ImprovementPlanSemaforo | null;
  hasPendingClosureApproval: boolean;
  pendingClosureOutcome: ImprovementPlanOutcome | null;
  createdAt: string;
};

export type ImprovementPlanDetailDTO = ImprovementPlanSummaryDTO & {
  situacion: string;
  resultadoEsperado: string;
  stageDurationDays: number;
  stageStartedAt: string;
  closureNotes: string | null;
  pendingClosureNotes: string | null;
  pendingClosureRequestedAt: string | null;
  pendingClosureRequestedByName: string | null;
  pendingClosureRejectedAt: string | null;
  adminApprovedAt: string | null;
  adminApprovedByName: string | null;
  commitments: ImprovementPlanCommitmentDTO[];
  reviews: ImprovementPlanReviewDTO[];
  // Solo presente en la respuesta de GET /api/improvement-plans/[id] (ver
  // esa route) — si el usuario que mira puede registrar evaluaciones/decidir
  // etapa/pedir cierre en ESTE plan puntual. No se calcula acá porque
  // depende de la sesión, no de los datos del plan.
  canAct?: boolean;
};

function mapPlanSummary(plan: PlanRow): ImprovementPlanSummaryDTO {
  return {
    id: plan.id,
    collaboratorId: plan.collaboratorId,
    collaboratorName: plan.collaborator.name,
    leaderId: plan.leaderId,
    leaderName: plan.leader?.name ?? null,
    deptId: plan.deptId,
    deptName: plan.dept.name,
    stage: plan.stage,
    stageDeadline: plan.stageDeadline.toISOString(),
    outcome: plan.outcome,
    closedAt: plan.closedAt?.toISOString() ?? null,
    latestSemaforo: plan.reviews[0]?.semaforo ?? null,
    hasPendingClosureApproval: !!plan.pendingClosureOutcome,
    pendingClosureOutcome: plan.pendingClosureOutcome,
    createdAt: plan.createdAt.toISOString(),
  };
}

function mapPlanDetail(plan: PlanRow): ImprovementPlanDetailDTO {
  return {
    ...mapPlanSummary(plan),
    situacion: plan.situacion,
    resultadoEsperado: plan.resultadoEsperado,
    stageDurationDays: plan.stageDurationDays,
    stageStartedAt: plan.stageStartedAt.toISOString(),
    closureNotes: plan.closureNotes,
    pendingClosureNotes: plan.pendingClosureNotes,
    pendingClosureRequestedAt: plan.pendingClosureRequestedAt?.toISOString() ?? null,
    pendingClosureRequestedByName: plan.pendingClosureRequestedBy?.name ?? null,
    pendingClosureRejectedAt: plan.pendingClosureRejectedAt?.toISOString() ?? null,
    adminApprovedAt: plan.adminApprovedAt?.toISOString() ?? null,
    adminApprovedByName: plan.adminApprovedBy?.name ?? null,
    commitments: plan.commitments.map((c) => ({
      id: c.id,
      indicador: c.indicador,
      meta: c.meta,
      responsable: c.responsable,
      order: c.order,
    })),
    reviews: plan.reviews.map((r) => ({
      id: r.id,
      weekOf: r.weekOf.toISOString(),
      scores: r.scores as Record<string, number>,
      avgScore: r.avgScore,
      semaforo: r.semaforo,
      queMejoro: r.queMejoro,
      queFalta: r.queFalta,
      accionSiguiente: r.accionSiguiente,
      apoyoLider: r.apoyoLider,
      aiAssisted: r.aiAssisted,
      createdByName: r.createdBy?.name ?? null,
      createdAt: r.createdAt.toISOString(),
    })),
  };
}

export async function getImprovementPlanDTO(id: string): Promise<ImprovementPlanDetailDTO | null> {
  const plan = await prisma.improvementPlan.findUnique({ where: { id }, include: PLAN_INCLUDE });
  return plan ? mapPlanDetail(plan) : null;
}

export async function listImprovementPlansForDept(deptId: string): Promise<ImprovementPlanSummaryDTO[]> {
  const plans = await prisma.improvementPlan.findMany({ where: { deptId }, include: PLAN_INCLUDE, orderBy: { createdAt: "desc" } });
  return plans.map(mapPlanSummary);
}

export async function listImprovementPlansForCollaborator(userId: string): Promise<ImprovementPlanDetailDTO[]> {
  const plans = await prisma.improvementPlan.findMany({
    where: { collaboratorId: userId },
    include: PLAN_INCLUDE,
    orderBy: { createdAt: "desc" },
  });
  return plans.map(mapPlanDetail);
}

export async function getActiveImprovementPlanForCollaborator(userId: string): Promise<ImprovementPlanDetailDTO | null> {
  const plan = await prisma.improvementPlan.findFirst({
    where: { collaboratorId: userId, stage: { not: "CERRADO" } },
    include: PLAN_INCLUDE,
    orderBy: { createdAt: "desc" },
  });
  return plan ? mapPlanDetail(plan) : null;
}

// Panel global de admin — confirmado 2026-09-10: todo el historial, no solo
// lo activo, para que sirva como tablero de auditoría además de bandeja de
// aprobaciones (ver pendingClosureOutcome en cada fila).
export async function listAllImprovementPlansForAdmin(): Promise<ImprovementPlanSummaryDTO[]> {
  const plans = await prisma.improvementPlan.findMany({ include: PLAN_INCLUDE, orderBy: { createdAt: "desc" }, take: 300 });
  return plans.map(mapPlanSummary);
}

export type ImprovementPlanRosterEntryDTO = {
  userId: string;
  userName: string;
  activePlan: ImprovementPlanSummaryDTO | null;
};

// Roster del equipo con el estado de su plan (si tiene uno activo) — usado
// por ImprovementPlanTeamPanel para decidir a quién ofrecer "Iniciar plan"
// vs. a quién llevar directo al detalle de su plan en curso. Corregido
// 2026-09-10: un líder NUNCA puede abrirle un plan a otro líder (ni a sí
// mismo) — el desempeño de los líderes lo maneja el admin directamente, no
// entre pares. Solo el admin ve también a los líderes en este listado.
export async function getDeptRosterWithImprovementPlanStatus(deptId: string, includeLeaders: boolean): Promise<ImprovementPlanRosterEntryDTO[]> {
  const [members, activePlans] = await Promise.all([
    prisma.user.findMany({
      where: { deptId, isActive: true, ...(includeLeaders ? {} : { isLeader: false }) },
      select: { id: true, name: true },
      orderBy: { name: "asc" },
    }),
    prisma.improvementPlan.findMany({ where: { deptId, stage: { not: "CERRADO" } }, include: PLAN_INCLUDE }),
  ]);
  const planByCollaborator = new Map(activePlans.map((p) => [p.collaboratorId, mapPlanSummary(p)]));
  return members.map((m) => ({ userId: m.id, userName: m.name, activePlan: planByCollaborator.get(m.id) ?? null }));
}

export async function createImprovementPlan(params: {
  collaboratorId: string;
  deptId: string;
  actorId: string;
  situacion: string;
  resultadoEsperado: string;
  stageDurationDays?: number;
  commitments: { indicador: string; meta: string; responsable: ImprovementPlanCommitmentResponsible }[];
}): Promise<ImprovementPlanDetailDTO> {
  const stageDurationDays =
    params.stageDurationDays && params.stageDurationDays > 0 ? params.stageDurationDays : DEFAULT_STAGE_DURATION_DAYS;
  const stageStartedAt = new Date();
  const stageDeadline = stageDeadlineFrom(stageStartedAt, stageDurationDays);

  const plan = await prisma.improvementPlan.create({
    data: {
      collaboratorId: params.collaboratorId,
      leaderId: dbUserId(params.actorId),
      deptId: params.deptId,
      situacion: params.situacion,
      resultadoEsperado: params.resultadoEsperado,
      stageDurationDays,
      stageStartedAt,
      stageDeadline,
      commitments: {
        create: params.commitments.map((c, idx) => ({ indicador: c.indicador, meta: c.meta, responsable: c.responsable, order: idx })),
      },
    },
    include: PLAN_INCLUDE,
  });

  const commitmentLines = params.commitments.map((c) => `${c.indicador}: ${c.meta}`).join(" · ");
  await notifyOwner(params.collaboratorId, {
    title: "Se abrió un Plan de Mejora para ti",
    body: `Tu líder inició un plan de acompañamiento. Compromisos — ${commitmentLines}`,
    url: "/area",
  }).catch(() => null);

  return mapPlanDetail(plan);
}

export async function addWeeklyReview(params: {
  planId: string;
  actorId: string;
  weekOf: Date;
  scores: Record<string, number>;
  queMejoro: string;
  queFalta: string;
  accionSiguiente: string;
  apoyoLider: string;
  aiAssisted: boolean;
}): Promise<ImprovementPlanDetailDTO> {
  const plan = await prisma.improvementPlan.findUnique({ where: { id: params.planId }, select: { stage: true, collaboratorId: true } });
  if (!plan) throw new Error("Plan no encontrado.");
  if (plan.stage === "CERRADO") throw new Error("El plan ya está cerrado — no se pueden agregar evaluaciones.");

  const avgScore = computeAvgScore(params.scores);
  const semaforo = computeSemaforo(avgScore);

  await prisma.improvementPlanReview.create({
    data: {
      planId: params.planId,
      weekOf: params.weekOf,
      scores: params.scores as Prisma.InputJsonValue,
      avgScore,
      semaforo,
      queMejoro: params.queMejoro,
      queFalta: params.queFalta,
      accionSiguiente: params.accionSiguiente,
      apoyoLider: params.apoyoLider,
      aiAssisted: params.aiAssisted,
      createdById: dbUserId(params.actorId),
    },
  });

  // Confirmado 2026-09-10: antes solo se avisaba al abrir/cerrar el plan —
  // el colaborador (transparencia total sobre su propio caso) ahora también
  // se entera cada semana que hay una evaluación nueva, en vez de tener que
  // entrar a mirar por su cuenta para descubrirla.
  await notifyOwner(plan.collaboratorId, {
    title: "Nueva evaluación de tu Plan de Mejora",
    body: "Tu líder registró cómo te fue esta semana — revisa el detalle en tu cuenta.",
    url: "/area",
  }).catch(() => null);

  const detail = await getImprovementPlanDTO(params.planId);
  if (!detail) throw new Error("Plan no encontrado.");
  return detail;
}

// Único punto de notificación al admin al entrar a Etapa Final — guardado
// por finalStageNotifiedAt para que nunca se repita (ver docblock del campo
// en schema.prisma), sin importar cuántas veces se recalcule el estado.
async function notifyAdminFinalStageOnce(planId: string): Promise<void> {
  const plan = await prisma.improvementPlan.findUnique({
    where: { id: planId },
    select: { finalStageNotifiedAt: true, collaborator: { select: { name: true } }, dept: { select: { name: true } } },
  });
  if (!plan || plan.finalStageNotifiedAt) return;
  await prisma.improvementPlan.update({ where: { id: planId }, data: { finalStageNotifiedAt: new Date() } });
  await notifyOwner("admin", {
    title: "⚠️ Plan de Mejora llegó a Etapa Final",
    body: `${plan.collaborator.name} (${plan.dept.name}) no mostró mejora suficiente y su plan pasó a la etapa final.`,
    url: "/admin/plan-mejora",
  }).catch(() => null);
}

async function closePlanAsContinuidad(planId: string, notes: string): Promise<void> {
  const plan = await prisma.improvementPlan.update({
    where: { id: planId },
    data: { stage: "CERRADO", outcome: "CONTINUIDAD", closedAt: new Date(), closureNotes: notes },
    select: { collaboratorId: true },
  });
  await notifyOwner(plan.collaboratorId, {
    title: "Tu Plan de Mejora se cerró",
    body: "Resultado: Continuidad. Revisa el detalle completo en tu cuenta.",
    url: "/area",
  }).catch(() => null);
}

export type StageDecision = "SATISFACTORIO" | "INSUFICIENTE" | "SIN_MEJORA";

// El corazón del flujo de etapas (§ 7-8 del documento) — ver el docblock de
// ImprovementPlan en schema.prisma para el resumen completo de reglas.
export async function decideStageOutcome(params: {
  planId: string;
  actorId: string;
  decision: StageDecision;
  newStageDurationDays?: number;
}): Promise<ImprovementPlanDetailDTO> {
  const plan = await prisma.improvementPlan.findUnique({ where: { id: params.planId } });
  if (!plan) throw new Error("Plan no encontrado.");
  if (plan.stage === "CERRADO") throw new Error("El plan ya está cerrado.");
  if (plan.stage === "ETAPA_FINAL") {
    throw new Error(
      "En Etapa Final ya no se avanza de etapa — usa el cierre del plan (Continuidad, Reubicación o Revisión de continuidad).",
    );
  }

  if (params.decision === "SATISFACTORIO") {
    await closePlanAsContinuidad(params.planId, `Cierre satisfactorio al finalizar ${STAGE_LABEL[plan.stage]}.`);
    return (await getImprovementPlanDTO(params.planId))!;
  }

  const duration =
    params.newStageDurationDays && params.newStageDurationDays > 0 ? params.newStageDurationDays : plan.stageDurationDays;
  const stageStartedAt = new Date();
  const stageDeadline = stageDeadlineFrom(stageStartedAt, duration);

  // Primer período sin mejora suficiente pero con algo de avance -> pasa a
  // Extendido. Cualquier otro caso (Primer período sin ninguna mejora, o
  // Extendido que no salió satisfactorio) salta directo a Etapa Final — el
  // documento no contempla un segundo Extendido.
  const nextStage: ImprovementPlanStage = plan.stage === "PRIMER_PERIODO" && params.decision === "INSUFICIENTE" ? "EXTENDIDO" : "ETAPA_FINAL";

  await prisma.improvementPlan.update({
    where: { id: params.planId },
    data: { stage: nextStage, stageDurationDays: duration, stageStartedAt, stageDeadline },
  });

  if (nextStage === "ETAPA_FINAL") await notifyAdminFinalStageOnce(params.planId);

  return (await getImprovementPlanDTO(params.planId))!;
}

// Un líder puede pedir cualquiera de los 3 resultados desde cualquier etapa
// (no solo Etapa Final — ver docblock de ImprovementPlan) — CONTINUIDAD se
// aplica de inmediato, las otras dos quedan pendientes de aprobación admin.
export async function requestImprovementPlanClosure(params: {
  planId: string;
  actorId: string;
  outcome: ImprovementPlanOutcome;
  notes: string;
}): Promise<ImprovementPlanDetailDTO> {
  const plan = await prisma.improvementPlan.findUnique({ where: { id: params.planId }, select: { stage: true } });
  if (!plan) throw new Error("Plan no encontrado.");
  if (plan.stage === "CERRADO") throw new Error("El plan ya está cerrado.");

  if (params.outcome === "CONTINUIDAD") {
    await closePlanAsContinuidad(params.planId, params.notes);
    return (await getImprovementPlanDTO(params.planId))!;
  }

  const updated = await prisma.improvementPlan.update({
    where: { id: params.planId },
    data: {
      pendingClosureOutcome: params.outcome,
      pendingClosureNotes: params.notes,
      pendingClosureRequestedAt: new Date(),
      pendingClosureRequestedById: dbUserId(params.actorId),
      pendingClosureRejectedAt: null,
    },
    select: { collaborator: { select: { name: true } }, dept: { select: { name: true } } },
  });

  await notifyOwner("admin", {
    title: "Cierre de Plan de Mejora pendiente de tu aprobación",
    body: `${updated.collaborator.name} (${updated.dept.name}) — se pidió cerrar como ${OUTCOME_LABEL[params.outcome]}.`,
    url: "/admin/plan-mejora",
  }).catch(() => null);

  return (await getImprovementPlanDTO(params.planId))!;
}

export async function approveImprovementPlanClosure(params: {
  planId: string;
  adminActorId: string;
  approve: boolean;
  rejectionNote?: string;
}): Promise<ImprovementPlanDetailDTO> {
  const plan = await prisma.improvementPlan.findUnique({
    where: { id: params.planId },
    select: { pendingClosureOutcome: true, pendingClosureNotes: true, leaderId: true, collaboratorId: true },
  });
  if (!plan) throw new Error("Plan no encontrado.");
  if (!plan.pendingClosureOutcome) throw new Error("Este plan no tiene un cierre pendiente de aprobación.");

  if (params.approve) {
    const outcome = plan.pendingClosureOutcome;
    await prisma.improvementPlan.update({
      where: { id: params.planId },
      data: {
        stage: "CERRADO",
        outcome,
        closedAt: new Date(),
        closureNotes: plan.pendingClosureNotes,
        pendingClosureOutcome: null,
        pendingClosureNotes: null,
        adminApprovedAt: new Date(),
        adminApprovedById: dbUserId(params.adminActorId),
      },
    });

    if (plan.leaderId) {
      await notifyOwner(plan.leaderId, {
        title: "✅ Cierre de Plan de Mejora aprobado",
        body: `El admin aprobó el cierre como ${OUTCOME_LABEL[outcome]}.`,
        url: "/area/workspace?tab=plan-mejora",
      }).catch(() => null);
    }
    // Transparencia total del colaborador sobre su propio caso (ver docblock
    // del modelo) — se avisa siempre, sin exponer el resultado delicado en el
    // texto del push, solo que revise el detalle completo en su cuenta.
    await notifyOwner(plan.collaboratorId, {
      title: "Tu Plan de Mejora se cerró",
      body: "El proceso concluyó — revisa el detalle completo en tu cuenta.",
      url: "/area",
    }).catch(() => null);
  } else {
    await prisma.improvementPlan.update({
      where: { id: params.planId },
      data: { pendingClosureOutcome: null, pendingClosureNotes: null, pendingClosureRejectedAt: new Date() },
    });
    if (plan.leaderId) {
      await notifyOwner(plan.leaderId, {
        title: "❌ Cierre de Plan de Mejora rechazado",
        body: params.rejectionNote?.trim() ? params.rejectionNote : "El admin rechazó el cierre solicitado — el plan sigue abierto.",
        url: "/area/workspace?tab=plan-mejora",
      }).catch(() => null);
    }
  }

  return (await getImprovementPlanDTO(params.planId))!;
}
