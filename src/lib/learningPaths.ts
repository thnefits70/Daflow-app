import { prisma } from "@/lib/prisma";
import { generateQuestionsForContent, LEARNING_PATH_AI_MODEL, type ContentPart, type ContentSource } from "@/lib/learningPathAi";

export type ContentKind = "document" | "law" | "process" | "module";

export type ContentOptionDTO = {
  kind: ContentKind;
  refId: string;
  title: string;
  meta: string;
  hasQuestionSet: boolean;
};

function isPdf(fileName: string | null): boolean {
  return !!fileName && fileName.toLowerCase().endsWith(".pdf");
}

async function buildDocumentSource(documentId: string): Promise<ContentSource> {
  const doc = await prisma.document.findUniqueOrThrow({ where: { id: documentId } });
  const parts: ContentPart[] = [];
  if (doc.fileUrl && isPdf(doc.fileName)) {
    parts.push({ type: "pdf", url: doc.fileUrl, label: doc.fileName ?? doc.title });
  }
  if (doc.content.trim()) {
    parts.push({ type: "text", text: doc.content });
  }
  if (parts.length === 0 && doc.link.trim()) {
    parts.push({ type: "text", text: `Este documento solo tiene un enlace externo (${doc.link}), sin texto propio.` });
  }
  return { title: doc.title, parts };
}

async function buildProcessSource(processId: string): Promise<ContentSource> {
  const process = await prisma.process.findUniqueOrThrow({
    where: { id: processId },
    include: { flowSteps: { orderBy: { order: "asc" }, include: { branches: true, checklistItems: true } } },
  });
  const lines: string[] = [];
  if (process.description.trim()) lines.push(process.description.trim());
  for (const step of process.flowSteps) {
    lines.push(`- [${step.type}] ${step.label}${step.detail ? `: ${step.detail}` : ""}`);
    for (const item of step.checklistItems) lines.push(`    · ${item.text}`);
    for (const branch of step.branches) if (branch.label) lines.push(`    → ${branch.label}`);
  }
  return { title: process.title, parts: [{ type: "text", text: lines.join("\n") }] };
}

async function buildModuleSource(moduleId: string): Promise<ContentSource> {
  const mod = await prisma.module.findUniqueOrThrow({ where: { id: moduleId }, include: { documents: true } });
  const parts: ContentPart[] = [];
  for (const doc of mod.documents) {
    if (doc.fileUrl && isPdf(doc.fileName)) {
      parts.push({ type: "pdf", url: doc.fileUrl, label: doc.fileName ?? doc.title });
    }
    if (doc.content.trim()) {
      parts.push({ type: "text", text: `— ${doc.title} —\n${doc.content}` });
    }
  }
  return { title: mod.title, parts };
}

export async function buildSourceForGeneration(kind: ContentKind, refId: string): Promise<ContentSource> {
  if (kind === "process") return buildProcessSource(refId);
  if (kind === "module") return buildModuleSource(refId);
  return buildDocumentSource(refId);
}

const fkField: Record<ContentKind, "documentId" | "processId" | "moduleId"> = {
  document: "documentId",
  law: "documentId",
  process: "processId",
  module: "moduleId",
};

// Reutiliza el banco de preguntas si ya existe para este contenido; si no,
// genera con IA y lo guarda. Nunca regenera solo porque un paso nuevo lo usa.
export async function getOrCreateQuestionSet(kind: ContentKind, refId: string) {
  const field = fkField[kind];
  const existing = await prisma.contentQuestionSet.findFirst({
    where: { [field]: refId },
    include: { questions: { orderBy: { order: "asc" } } },
  });
  if (existing) return existing;

  const source = await buildSourceForGeneration(kind, refId);
  const result = await generateQuestionsForContent(source);

  return prisma.contentQuestionSet.create({
    data: {
      [field]: refId,
      aiModel: LEARNING_PATH_AI_MODEL,
      estimatedMinutes: result.estimatedMinutes,
      sampleSize: result.sampleSize,
      questions: {
        create: result.questions.map((q, order) => ({
          type: q.type,
          text: q.text,
          options: q.options,
          matchLeft: q.matchLeft,
          correctIndex: q.correctIndex,
          order,
        })),
      },
    },
    include: { questions: { orderBy: { order: "asc" } } },
  });
}

type QuestionSetWithContent = {
  documentId: string | null;
  processId: string | null;
  moduleId: string | null;
  document: { title: string; isLaw: boolean; department: { name: string } | null } | null;
  process: { title: string; department: { name: string } | null } | null;
  module: { title: string } | null;
};

export function describeQuestionSet(set: QuestionSetWithContent): { kind: ContentKind; title: string; meta: string } {
  if (set.process) return { kind: "process", title: set.process.title, meta: `Proceso · ${set.process.department?.name ?? ""}` };
  if (set.module) return { kind: "module", title: set.module.title, meta: "Módulo completo" };
  if (set.document) {
    return {
      kind: set.document.isLaw ? "law" : "document",
      title: set.document.title,
      meta: set.document.isLaw ? "Ley y Reglamento" : set.document.department?.name ?? "Documento",
    };
  }
  return { kind: "document", title: "Contenido", meta: "" };
}

const questionSetContentInclude = {
  document: { select: { title: true, isLaw: true, department: { select: { name: true } } } },
  process: { select: { title: true, department: { select: { name: true } } } },
  module: { select: { title: true } },
} as const;

export async function createLearningPath(title: string, description: string) {
  return prisma.learningPath.create({ data: { title, description } });
}

export async function listLearningPaths() {
  const paths = await prisma.learningPath.findMany({
    orderBy: { createdAt: "asc" },
    include: {
      _count: { select: { steps: true, assignments: true } },
    },
  });
  return paths.map((p) => ({
    id: p.id,
    title: p.title,
    description: p.description,
    stepCount: p._count.steps,
    assignmentCount: p._count.assignments,
  }));
}

export async function getLearningPathDetail(pathId: string) {
  const path = await prisma.learningPath.findUnique({
    where: { id: pathId },
    include: {
      steps: {
        orderBy: { order: "asc" },
        include: {
          questionSet: {
            include: { questions: { orderBy: { order: "asc" } }, ...questionSetContentInclude },
          },
        },
      },
      assignments: {
        include: { user: { select: { id: true, name: true, position: true, department: { select: { name: true } } } } },
      },
    },
  });
  if (!path) return null;

  return {
    id: path.id,
    title: path.title,
    description: path.description,
    totalEstimatedMinutes: path.steps.reduce((s, st) => s + st.questionSet.estimatedMinutes, 0),
    steps: path.steps.map((step) => {
      const desc = describeQuestionSet(step.questionSet);
      return {
        id: step.id,
        order: step.order,
        kind: desc.kind,
        title: desc.title,
        meta: desc.meta,
        setId: step.questionSetId,
        estimatedMinutes: step.questionSet.estimatedMinutes,
        sampleSize: step.questionSet.sampleSize,
        questions: step.questionSet.questions,
      };
    }),
    assignments: path.assignments.map((a) => ({
      userId: a.userId,
      name: a.user.name,
      position: a.user.position,
      department: a.user.department?.name ?? null,
      dueAt: addBusinessDays(a.assignedAt, LEARNING_PATH_DEADLINE_BUSINESS_DAYS).toISOString(),
    })),
  };
}

export async function addStepToPath(pathId: string, kind: ContentKind, refId: string) {
  const questionSet = await getOrCreateQuestionSet(kind, refId);
  const maxOrder = await prisma.learningPathStep.aggregate({ where: { pathId }, _max: { order: true } });
  return prisma.learningPathStep.create({
    data: { pathId, questionSetId: questionSet.id, order: (maxOrder._max.order ?? -1) + 1 },
  });
}

export async function reorderSteps(pathId: string, orderedIds: string[]) {
  await prisma.$transaction(
    orderedIds.map((id, order) => prisma.learningPathStep.update({ where: { id, pathId }, data: { order } }))
  );
}

export async function assignUserToPath(pathId: string, userId: string) {
  return prisma.learningPathAssignment.upsert({
    where: { pathId_userId: { pathId, userId } },
    create: { pathId, userId },
    update: {},
  });
}

export type MyPathStepDTO = {
  id: string;
  order: number;
  kind: ContentKind;
  title: string;
  meta: string;
  estimatedMinutes: number;
  questionCount: number;
  status: "done" | "current" | "locked" | "failed-cooldown" | "failed-retry-available";
  correctCount: number | null;
  totalCount: number | null;
  retryAvailableAt: string | null;
};

export type MyPathDTO = {
  id: string;
  title: string;
  description: string;
  totalEstimatedMinutes: number;
  assignedAt: string;
  dueAt: string;
  steps: MyPathStepDTO[];
};

// Confirmado 2026-07-27: un nuevo ingreso tiene 5 días laborables (fines de
// semana no cuentan) desde que se le asigna la ruta para completarla, sin
// necesidad de hacerlo todo de una sola sentada — puede seguir trabajando y
// avanzar a ratos dentro de ese plazo.
const LEARNING_PATH_DEADLINE_BUSINESS_DAYS = 5;

// Confirmado 2026-07-27: aprobar un paso requiere >= 8/10 (80%). Si reprueba,
// puede reintentar recién a las 24 horas laborables — horario de oficina
// lunes a sábado 8:00-18:00, hora de Ecuador (UTC-5; el servidor corre en
// UTC, así que hay que correr el reloj antes de mirar día/hora — mismo
// truco que nowInEcuador() en pendingTasks.ts). Domingo no cuenta.
const PASS_THRESHOLD = 0.8;
const RETRY_COOLDOWN_BUSINESS_HOURS = 24;
const ECUADOR_OFFSET_MS = 5 * 60 * 60 * 1000;
const BUSINESS_START_HOUR = 8;
const BUSINESS_END_HOUR = 18;

function addBusinessHours(start: Date, hours: number): Date {
  // Se trabaja enteramente en "hora de Ecuador desplazada" y se devuelve el
  // resultado ya corregido de vuelta a UTC real.
  let cur = new Date(start.getTime() - ECUADOR_OFFSET_MS);

  const snapToWindow = (d: Date) => {
    while (d.getUTCDay() === 0) {
      d.setUTCDate(d.getUTCDate() + 1);
      d.setUTCHours(BUSINESS_START_HOUR, 0, 0, 0);
    }
    if (d.getUTCHours() < BUSINESS_START_HOUR) {
      d.setUTCHours(BUSINESS_START_HOUR, 0, 0, 0);
    } else if (d.getUTCHours() >= BUSINESS_END_HOUR) {
      d.setUTCDate(d.getUTCDate() + 1);
      d.setUTCHours(BUSINESS_START_HOUR, 0, 0, 0);
      snapToWindow(d);
    }
  };
  snapToWindow(cur);

  let remainingMs = hours * 60 * 60 * 1000;
  while (remainingMs > 0) {
    const dayEnd = new Date(cur);
    dayEnd.setUTCHours(BUSINESS_END_HOUR, 0, 0, 0);
    const availableMs = dayEnd.getTime() - cur.getTime();
    if (availableMs <= 0) {
      cur.setUTCDate(cur.getUTCDate() + 1);
      cur.setUTCHours(BUSINESS_START_HOUR, 0, 0, 0);
      snapToWindow(cur);
      continue;
    }
    if (remainingMs <= availableMs) {
      cur = new Date(cur.getTime() + remainingMs);
      remainingMs = 0;
    } else {
      remainingMs -= availableMs;
      cur.setUTCDate(cur.getUTCDate() + 1);
      cur.setUTCHours(BUSINESS_START_HOUR, 0, 0, 0);
      snapToWindow(cur);
    }
  }
  return new Date(cur.getTime() + ECUADOR_OFFSET_MS);
}

function addBusinessDays(start: Date, days: number): Date {
  const d = new Date(start);
  let added = 0;
  while (added < days) {
    d.setDate(d.getDate() + 1);
    const day = d.getDay();
    if (day !== 0 && day !== 6) added++;
  }
  return d;
}

function isPassingAttempt(p: { completedAt: Date | null; correctCount: number | null; totalCount: number | null } | null | undefined): boolean {
  if (!p?.completedAt || p.correctCount == null || !p.totalCount) return false;
  return p.correctCount / p.totalCount >= PASS_THRESHOLD;
}

export async function getMyLearningPaths(userId: string): Promise<MyPathDTO[]> {
  const assignments = await prisma.learningPathAssignment.findMany({
    where: { userId },
    include: {
      path: {
        include: {
          steps: {
            orderBy: { order: "asc" },
            include: {
              questionSet: { include: { questions: true, ...questionSetContentInclude } },
              // El intento más reciente primero — es lo único que importa
              // para saber el estado actual del paso.
              progress: { where: { userId }, orderBy: { attemptNumber: "desc" }, take: 1 },
            },
          },
        },
      },
    },
  });

  const now = new Date();

  return assignments.map(({ path, assignedAt }) => {
    let blockingFound = false;
    const steps: MyPathStepDTO[] = path.steps.map((step) => {
      const latest = step.progress[0] as
        | { completedAt: Date | null; correctCount: number | null; totalCount: number | null; retryAvailableAt: Date | null }
        | undefined;
      const passed = isPassingAttempt(latest);

      let status: MyPathStepDTO["status"] = "locked";
      let retryAvailableAt: string | null = null;
      if (passed) {
        status = "done";
      } else if (!blockingFound) {
        blockingFound = true;
        if (latest?.completedAt) {
          const cooldownActive = !!latest.retryAvailableAt && now < latest.retryAvailableAt;
          status = cooldownActive ? "failed-cooldown" : "failed-retry-available";
          retryAvailableAt = latest.retryAvailableAt?.toISOString() ?? null;
        } else {
          status = "current";
        }
      }

      const desc = describeQuestionSet(step.questionSet);
      const attempted = !!latest?.completedAt;
      return {
        id: step.id,
        order: step.order,
        kind: desc.kind,
        title: desc.title,
        meta: desc.meta,
        estimatedMinutes: step.questionSet.estimatedMinutes,
        questionCount: Math.min(step.questionSet.sampleSize, step.questionSet.questions.length) || step.questionSet.questions.length,
        status,
        correctCount: attempted ? latest!.correctCount : null,
        totalCount: attempted ? latest!.totalCount : null,
        retryAvailableAt,
      };
    });
    return {
      id: path.id,
      title: path.title,
      description: path.description,
      totalEstimatedMinutes: path.steps.reduce((s, st) => s + st.questionSet.estimatedMinutes, 0),
      assignedAt: assignedAt.toISOString(),
      dueAt: addBusinessDays(assignedAt, LEARNING_PATH_DEADLINE_BUSINESS_DAYS).toISOString(),
      steps,
    };
  });
}

// Solo se puede tomar un paso si todos los anteriores de esa ruta ya se
// APROBARON (>= 8/10) — un paso reprobado no desbloquea el siguiente.
async function assertStepUnlocked(userId: string, stepId: string) {
  const step = await prisma.learningPathStep.findUniqueOrThrow({ where: { id: stepId } });
  const priorSteps = await prisma.learningPathStep.findMany({
    where: { pathId: step.pathId, order: { lt: step.order } },
  });
  for (const prior of priorSteps) {
    const latest = await prisma.learningPathStepProgress.findFirst({
      where: { userId, stepId: prior.id },
      orderBy: { attemptNumber: "desc" },
    });
    if (!isPassingAttempt(latest)) throw new Error("Debes aprobar los pasos anteriores primero (nota mínima 8/10).");
  }
  return step;
}

// Determina qué número de intento usar ahora mismo — 1 si nunca lo tomó,
// el siguiente si ya reprobó y pasaron las 24 horas laborables, o lanza un
// error si ya aprobó (nada que reintentar) o si el enfriamiento sigue activo.
async function getActiveAttemptNumber(userId: string, stepId: string): Promise<number> {
  const latest = await prisma.learningPathStepProgress.findFirst({
    where: { userId, stepId },
    orderBy: { attemptNumber: "desc" },
  });
  if (!latest) return 1;
  if (isPassingAttempt(latest)) return latest.attemptNumber; // ya aprobado, no hay nada que reintentar
  if (!latest.completedAt) return latest.attemptNumber; // intento a medias, sigue siendo el mismo
  if (latest.retryAvailableAt && new Date() < latest.retryAvailableAt) {
    const when = latest.retryAvailableAt.toLocaleString("es-EC", { day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit" });
    throw new Error(`Reprobaste este paso. Puedes reintentarlo a partir del ${when}.`);
  }
  return latest.attemptNumber + 1;
}

// PRNG determinístico (mulberry32 sobre un hash FNV-1a del seed) — así cada
// persona ve una muestra y un orden de opciones distintos y ESTABLES (no
// cambian si recarga la página a medio intento), sin tener que guardar nada
// extra: el seed se deriva de userId+stepId(+questionId).
function hashSeed(s: string): number {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

function seededShuffle<T>(arr: T[], seed: string): T[] {
  let state = hashSeed(seed);
  const rng = () => {
    state |= 0;
    state = (state + 0x6d2b79f5) | 0;
    let t = Math.imul(state ^ (state >>> 15), 1 | state);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  const copy = [...arr];
  for (let i = copy.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [copy[i], copy[j]] = [copy[j], copy[i]];
  }
  return copy;
}

export type TakeableQuestion = {
  id: string;
  type: string;
  text: string;
  options: { id: number; label: string }[];
  matchLeft: string[];
};

// Cada persona ve solo una muestra aleatoria (pero estable para ella) del
// banco de preguntas de este contenido, no el banco completo — así dos
// personas con la misma ruta no ven necesariamente las mismas preguntas ni en
// el mismo orden de opciones, y no pueden simplemente copiarse respuestas.
export async function getStepForTaking(userId: string, stepId: string) {
  const step = await assertStepUnlocked(userId, stepId);
  const attemptNumber = await getActiveAttemptNumber(userId, stepId);
  const questionSet = await prisma.contentQuestionSet.findUniqueOrThrow({
    where: { id: step.questionSetId },
    include: { questions: { orderBy: { order: "asc" } }, ...questionSetContentInclude },
  });
  const desc = describeQuestionSet(questionSet);

  // El seed incluye attemptNumber — un reintento después de reprobar saca
  // una muestra y un orden distintos, no exactamente las mismas preguntas.
  const pool = seededShuffle(questionSet.questions, `${userId}:${stepId}:${attemptNumber}:pool`);
  const sampleCount = Math.min(questionSet.sampleSize, pool.length) || pool.length;
  const sample = pool.slice(0, sampleCount);

  const questions: TakeableQuestion[] = sample.map((q) => {
    if (q.type === "SHORT_ANSWER") {
      return { id: q.id, type: q.type, text: q.text, options: [], matchLeft: [] };
    }
    const options = seededShuffle(
      q.options.map((label, id) => ({ id, label })),
      `${userId}:${stepId}:${attemptNumber}:${q.id}`
    );
    return { id: q.id, type: q.type, text: q.text, options, matchLeft: q.type === "MATCHING" ? q.matchLeft : [] };
  });

  // Si ya había un intento a medias (la persona salió y volvió), le
  // devolvemos lo que ya había contestado para que el cliente retome ahí.
  const existingProgress = await prisma.learningPathStepProgress.findUnique({
    where: { stepId_userId_attemptNumber: { stepId, userId, attemptNumber } },
    include: { answers: true },
  });
  const sampleIds = new Set(sample.map((q) => q.id));
  const savedAnswers =
    existingProgress?.answers
      .filter((a) => sampleIds.has(a.questionId))
      .map((a) => ({
        questionId: a.questionId,
        selectedIndex: a.selectedIndex ?? undefined,
        matchOrder: a.matchOrder.length > 0 ? a.matchOrder : undefined,
        textAnswer: a.textAnswer ?? undefined,
      })) ?? [];

  return { stepId: step.id, kind: desc.kind, title: desc.title, attemptNumber, questions, savedAnswers };
}

export type AnswerSubmission = {
  questionId: string;
  selectedIndex?: number;
  matchOrder?: number[];
  textAnswer?: string;
};

function gradeAnswer(
  q: { type: string; correctIndex: number | null },
  ans: AnswerSubmission
): boolean | null {
  if (q.type === "MULTIPLE_CHOICE" || q.type === "TRUE_FALSE") {
    return ans.selectedIndex === q.correctIndex;
  }
  if (q.type === "MATCHING") {
    return Array.isArray(ans.matchOrder) && ans.matchOrder.length > 0 && ans.matchOrder.every((v, i) => v === i);
  }
  return null; // SHORT_ANSWER — el admin la revisa manualmente
}

// Guarda UNA respuesta a medida que el colaborador avanza, sin marcar el paso
// como terminado — así si tiene que salir a atender algo urgente, al volver
// (una hora después o al día siguiente) retoma exactamente donde se quedó en
// vez de perder lo ya contestado.
export async function saveStepAnswer(userId: string, stepId: string, ans: AnswerSubmission) {
  await assertStepUnlocked(userId, stepId);
  const attemptNumber = await getActiveAttemptNumber(userId, stepId);
  const q = await prisma.learningPathQuestion.findUniqueOrThrow({ where: { id: ans.questionId } });

  const progress = await prisma.learningPathStepProgress.upsert({
    where: { stepId_userId_attemptNumber: { stepId, userId, attemptNumber } },
    create: { stepId, userId, attemptNumber },
    update: {},
  });

  const isCorrect = gradeAnswer(q, ans);
  await prisma.learningPathAnswer.upsert({
    where: { progressId_questionId: { progressId: progress.id, questionId: q.id } },
    create: {
      progressId: progress.id,
      questionId: q.id,
      selectedIndex: ans.selectedIndex ?? null,
      matchOrder: ans.matchOrder ?? [],
      textAnswer: ans.textAnswer ?? null,
      isCorrect,
    },
    update: {
      selectedIndex: ans.selectedIndex ?? null,
      matchOrder: ans.matchOrder ?? [],
      textAnswer: ans.textAnswer ?? null,
      isCorrect,
    },
  });
  return { ok: true };
}

// Guarda todas las respuestas finales y recién ahí marca el paso como
// terminado. Si la nota queda >= 8/10 desbloquea el siguiente paso; si no,
// queda reprobado y solo puede reintentar a las 24 horas laborables — nunca
// se le muestra cuál pregunta falló, solo la nota general (para que tenga
// que repasar todo el contenido, no memorizar el error puntual).
export async function submitStepAnswers(userId: string, stepId: string, answers: AnswerSubmission[]) {
  await assertStepUnlocked(userId, stepId);
  const attemptNumber = await getActiveAttemptNumber(userId, stepId);
  const questions = await prisma.learningPathQuestion.findMany({ where: { set: { steps: { some: { id: stepId } } } } });
  const byId = new Map(questions.map((q) => [q.id, q]));

  let correctCount = 0;
  for (const ans of answers) {
    const q = byId.get(ans.questionId);
    if (!q) continue;
    if (gradeAnswer(q, ans)) correctCount++;
  }
  const total = answers.length;
  const passed = total > 0 && correctCount / total >= PASS_THRESHOLD;
  const now = new Date();
  const retryAvailableAt = passed ? null : addBusinessHours(now, RETRY_COOLDOWN_BUSINESS_HOURS);

  const progress = await prisma.learningPathStepProgress.upsert({
    where: { stepId_userId_attemptNumber: { stepId, userId, attemptNumber } },
    create: { stepId, userId, attemptNumber, completedAt: now, correctCount, totalCount: total, retryAvailableAt },
    update: { completedAt: now, correctCount, totalCount: total, retryAvailableAt },
  });

  for (const ans of answers) {
    const q = byId.get(ans.questionId);
    if (!q) continue;
    const isCorrect = gradeAnswer(q, ans);

    await prisma.learningPathAnswer.upsert({
      where: { progressId_questionId: { progressId: progress.id, questionId: q.id } },
      create: {
        progressId: progress.id,
        questionId: q.id,
        selectedIndex: ans.selectedIndex ?? null,
        matchOrder: ans.matchOrder ?? [],
        textAnswer: ans.textAnswer ?? null,
        isCorrect,
      },
      update: {
        selectedIndex: ans.selectedIndex ?? null,
        matchOrder: ans.matchOrder ?? [],
        textAnswer: ans.textAnswer ?? null,
        isCorrect,
      },
    });
  }

  return { correctCount, total, passed, retryAvailableAt: retryAvailableAt?.toISOString() ?? null };
}

// Resumen compacto para el tile de Inicio del propio colaborador — junto al
// "Nivel de conocimiento" de los exámenes clásicos, pero de Rutas de
// conocimiento (sistema separado, confirmado 2026-07-27).
export type MyLearningPathSummaryDTO = {
  hasAssignments: boolean;
  avgNote: number | null; // 1-10, promedio de los pasos ya intentados
  stepsPassed: number;
  stepsAttempted: number;
  stepsTotal: number;
  hasPendingRetry: boolean;
};

export function summarizeMyLearningPaths(paths: MyPathDTO[]): MyLearningPathSummaryDTO {
  let stepsPassed = 0, stepsAttempted = 0, stepsTotal = 0, noteSum = 0, hasPendingRetry = false;
  for (const path of paths) {
    for (const step of path.steps) {
      stepsTotal++;
      if (step.status === "done") {
        stepsPassed++;
        stepsAttempted++;
        if (step.totalCount) noteSum += (10 * (step.correctCount ?? 0)) / step.totalCount;
      } else if (step.status === "failed-cooldown" || step.status === "failed-retry-available") {
        stepsAttempted++;
        hasPendingRetry = true;
        if (step.totalCount) noteSum += (10 * (step.correctCount ?? 0)) / step.totalCount;
      }
    }
  }
  return {
    hasAssignments: paths.length > 0,
    avgNote: stepsAttempted > 0 ? noteSum / stepsAttempted : null,
    stepsPassed,
    stepsAttempted,
    stepsTotal,
    hasPendingRetry,
  };
}

// Historial de todo el equipo — solo admin, confirmado 2026-07-27 ("yo
// también ver el historial de todas las notas, de todo el equipo").
export type TeamLearningPathResultDTO = {
  userId: string;
  name: string;
  position: string | null;
  department: string | null;
  pathTitles: string[];
  stepsPassed: number;
  stepsTotal: number;
  avgNote: number | null;
  hasPendingRetry: boolean;
};

export async function getTeamLearningPathResults(): Promise<TeamLearningPathResultDTO[]> {
  const assignments = await prisma.learningPathAssignment.findMany({
    include: {
      user: { select: { id: true, name: true, position: true, department: { select: { name: true } } } },
      path: { include: { steps: { select: { id: true } } } },
    },
  });
  if (assignments.length === 0) return [];

  const allProgress = await prisma.learningPathStepProgress.findMany({
    where: { userId: { in: [...new Set(assignments.map((a) => a.userId))] } },
    orderBy: { attemptNumber: "desc" },
  });
  const latestByUserStep = new Map<string, (typeof allProgress)[number]>();
  for (const p of allProgress) {
    const key = `${p.userId}:${p.stepId}`;
    if (!latestByUserStep.has(key)) latestByUserStep.set(key, p);
  }

  const byUser = new Map<string, typeof assignments>();
  for (const a of assignments) {
    if (!byUser.has(a.userId)) byUser.set(a.userId, []);
    byUser.get(a.userId)!.push(a);
  }

  const results: TeamLearningPathResultDTO[] = [];
  for (const [userId, userAssignments] of byUser) {
    const first = userAssignments[0];
    let stepsPassed = 0;
    let stepsTotal = 0;
    let stepsAttempted = 0;
    let noteSum = 0;
    let hasPendingRetry = false;
    for (const a of userAssignments) {
      for (const step of a.path.steps) {
        stepsTotal++;
        const latest = latestByUserStep.get(`${userId}:${step.id}`);
        if (latest?.completedAt && latest.correctCount != null && latest.totalCount) {
          stepsAttempted++;
          const note = (10 * latest.correctCount) / latest.totalCount;
          noteSum += note;
          if (note / 10 >= PASS_THRESHOLD) stepsPassed++;
          else hasPendingRetry = true;
        }
      }
    }
    results.push({
      userId,
      name: first.user.name,
      position: first.user.position,
      department: first.user.department?.name ?? null,
      pathTitles: userAssignments.map((a) => a.path.title),
      stepsPassed,
      stepsTotal,
      avgNote: stepsAttempted > 0 ? noteSum / stepsAttempted : null,
      hasPendingRetry,
    });
  }
  return results.sort((a, b) => (b.avgNote ?? -1) - (a.avgNote ?? -1));
}

// Busca en Documentos (área o Leyes y Reglamentos), Procesos y Módulos para
// el buscador de contenido del editor de rutas.
export async function searchContentOptions(query: string): Promise<ContentOptionDTO[]> {
  const q = query.trim();
  const contains = q.length > 0 ? { contains: q, mode: "insensitive" as const } : undefined;

  const [documents, processes, modules] = await Promise.all([
    prisma.document.findMany({
      where: { moduleId: null, ...(contains ? { title: contains } : {}) },
      include: { department: { select: { name: true } }, questionSet: { select: { id: true } } },
      take: 30,
      orderBy: { title: "asc" },
    }),
    prisma.process.findMany({
      where: contains ? { title: contains } : {},
      include: { department: { select: { name: true } }, questionSet: { select: { id: true } } },
      take: 30,
      orderBy: { title: "asc" },
    }),
    prisma.module.findMany({
      where: contains ? { title: contains } : {},
      include: { questionSet: { select: { id: true } } },
      take: 30,
      orderBy: { order: "asc" },
    }),
  ]);

  const documentOptions: ContentOptionDTO[] = documents.map((d) => ({
    kind: d.isLaw ? "law" : "document",
    refId: d.id,
    title: d.title,
    meta: d.isLaw ? "Ley y Reglamento" : d.department?.name ?? "Documento",
    hasQuestionSet: !!d.questionSet,
  }));
  const processOptions: ContentOptionDTO[] = processes.map((p) => ({
    kind: "process",
    refId: p.id,
    title: p.title,
    meta: `Proceso · ${p.department?.name ?? ""}`,
    hasQuestionSet: !!p.questionSet,
  }));
  const moduleOptions: ContentOptionDTO[] = modules.map((m) => ({
    kind: "module",
    refId: m.id,
    title: m.title,
    meta: "Módulo completo",
    hasQuestionSet: !!m.questionSet,
  }));

  return [...moduleOptions, ...documentOptions, ...processOptions];
}
