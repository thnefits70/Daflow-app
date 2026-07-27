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
        questions: step.questionSet.questions,
      };
    }),
    assignments: path.assignments.map((a) => ({
      userId: a.userId,
      name: a.user.name,
      position: a.user.position,
      department: a.user.department?.name ?? null,
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
  status: "done" | "current" | "locked";
  correctCount: number | null;
};

export type MyPathDTO = {
  id: string;
  title: string;
  description: string;
  totalEstimatedMinutes: number;
  steps: MyPathStepDTO[];
};

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
              progress: { where: { userId }, include: { answers: true } },
            },
          },
        },
      },
    },
  });

  return assignments.map(({ path }) => {
    let unlockedFound = false;
    const steps: MyPathStepDTO[] = path.steps.map((step) => {
      const progress = step.progress[0];
      const done = !!progress?.completedAt;
      let status: "done" | "current" | "locked" = "locked";
      if (done) status = "done";
      else if (!unlockedFound) {
        status = "current";
        unlockedFound = true;
      }
      const desc = describeQuestionSet(step.questionSet);
      const correctCount = done ? progress!.answers.filter((a) => a.isCorrect === true).length : null;
      return {
        id: step.id,
        order: step.order,
        kind: desc.kind,
        title: desc.title,
        meta: desc.meta,
        estimatedMinutes: step.questionSet.estimatedMinutes,
        questionCount: step.questionSet.questions.length,
        status,
        correctCount,
      };
    });
    return {
      id: path.id,
      title: path.title,
      description: path.description,
      totalEstimatedMinutes: path.steps.reduce((s, st) => s + st.questionSet.estimatedMinutes, 0),
      steps,
    };
  });
}

// Solo se puede tomar un paso si todos los anteriores de esa ruta ya están
// completos (o si ese mismo paso ya se completó, para poder revisarlo).
async function assertStepUnlocked(userId: string, stepId: string) {
  const step = await prisma.learningPathStep.findUniqueOrThrow({ where: { id: stepId } });
  const priorSteps = await prisma.learningPathStep.findMany({
    where: { pathId: step.pathId, order: { lt: step.order } },
  });
  if (priorSteps.length > 0) {
    const doneCount = await prisma.learningPathStepProgress.count({
      where: { userId, stepId: { in: priorSteps.map((s) => s.id) }, completedAt: { not: null } },
    });
    if (doneCount < priorSteps.length) throw new Error("Debes completar los pasos anteriores primero.");
  }
  return step;
}

export type TakeableQuestion = {
  id: string;
  type: string;
  text: string;
  options: string[] | { id: number; label: string }[];
  matchLeft: string[];
};

export async function getStepForTaking(userId: string, stepId: string) {
  const step = await assertStepUnlocked(userId, stepId);
  const questionSet = await prisma.contentQuestionSet.findUniqueOrThrow({
    where: { id: step.questionSetId },
    include: { questions: { orderBy: { order: "asc" } }, ...questionSetContentInclude },
  });
  const desc = describeQuestionSet(questionSet);

  const questions: TakeableQuestion[] = questionSet.questions.map((q) => {
    if (q.type === "MATCHING") {
      const shuffled = q.options.map((label, id) => ({ id, label })).sort(() => Math.random() - 0.5);
      return { id: q.id, type: q.type, text: q.text, options: shuffled, matchLeft: q.matchLeft };
    }
    return { id: q.id, type: q.type, text: q.text, options: q.options, matchLeft: [] };
  });

  return { stepId: step.id, kind: desc.kind, title: desc.title, questions };
}

export type AnswerSubmission = {
  questionId: string;
  selectedIndex?: number;
  matchOrder?: number[];
  textAnswer?: string;
};

export async function submitStepAnswers(userId: string, stepId: string, answers: AnswerSubmission[]) {
  await assertStepUnlocked(userId, stepId);
  const questions = await prisma.learningPathQuestion.findMany({ where: { set: { steps: { some: { id: stepId } } } } });
  const byId = new Map(questions.map((q) => [q.id, q]));

  const progress = await prisma.learningPathStepProgress.upsert({
    where: { stepId_userId: { stepId, userId } },
    create: { stepId, userId, completedAt: new Date() },
    update: { completedAt: new Date() },
  });

  let correctCount = 0;
  for (const ans of answers) {
    const q = byId.get(ans.questionId);
    if (!q) continue;
    let isCorrect: boolean | null = null;
    if (q.type === "MULTIPLE_CHOICE" || q.type === "TRUE_FALSE") {
      isCorrect = ans.selectedIndex === q.correctIndex;
    } else if (q.type === "MATCHING") {
      isCorrect = Array.isArray(ans.matchOrder) && ans.matchOrder.every((v, i) => v === i);
    }
    if (isCorrect) correctCount++;

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

  return { correctCount, total: questions.length };
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
