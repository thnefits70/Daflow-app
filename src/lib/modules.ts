import { prisma } from "@/lib/prisma";

export type ModuleSummaryDTO = {
  id: string;
  title: string;
  imageUrl: string | null;
  order: number;
  documentCount: number;
  examId: string | null;
  examQuestionCount: number;
};

export type ModuleDocumentDTO = {
  id: string;
  title: string;
  content: string;
  link: string;
  fileUrl: string | null;
  fileName: string | null;
};

export type ModuleDetailDTO = {
  id: string;
  title: string;
  imageUrl: string | null;
  imageName: string | null;
  documents: ModuleDocumentDTO[];
  exam: { id: string; title: string; questionCount: number } | null;
};

export async function getModules(): Promise<ModuleSummaryDTO[]> {
  const modules = await prisma.module.findMany({
    orderBy: { order: "asc" },
    include: {
      _count: { select: { documents: true } },
      exam: { select: { id: true, _count: { select: { questions: true } } } },
    },
  });
  return modules.map((m) => ({
    id: m.id,
    title: m.title,
    imageUrl: m.imageUrl,
    order: m.order,
    documentCount: m._count.documents,
    examId: m.exam?.id ?? null,
    examQuestionCount: m.exam?._count.questions ?? 0,
  }));
}

export async function getModule(id: string): Promise<ModuleDetailDTO | null> {
  const m = await prisma.module.findUnique({
    where: { id },
    include: {
      documents: { orderBy: { createdAt: "asc" } },
      exam: { select: { id: true, title: true, _count: { select: { questions: true } } } },
    },
  });
  if (!m) return null;
  return {
    id: m.id,
    title: m.title,
    imageUrl: m.imageUrl,
    imageName: m.imageName,
    documents: m.documents.map((d) => ({
      id: d.id,
      title: d.title,
      content: d.content,
      link: d.link,
      fileUrl: d.fileUrl,
      fileName: d.fileName,
    })),
    exam: m.exam ? { id: m.exam.id, title: m.exam.title, questionCount: m.exam._count.questions } : null,
  };
}
