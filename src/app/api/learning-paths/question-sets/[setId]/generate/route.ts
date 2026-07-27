import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireAdminSession } from "@/lib/guards";
import { generateQuestionsForContent } from "@/lib/learningPathAi";
import { buildSourceForGeneration } from "@/lib/learningPaths";

// Genera preguntas ADICIONALES con IA para un banco que ya existe (ej. el
// admin considera que 1-2 preguntas no alcanzan para un documento largo) —
// no reemplaza las que ya hay, se agregan al final.
export async function POST(_req: NextRequest, { params }: { params: Promise<{ setId: string }> }) {
  const session = await requireAdminSession();
  if (!session) return NextResponse.json({ error: "No autorizado." }, { status: 403 });

  const { setId } = await params;
  const set = await prisma.contentQuestionSet.findUnique({
    where: { id: setId },
    select: { id: true, documentId: true, processId: true, moduleId: true },
  });
  if (!set) return NextResponse.json({ error: "Banco de preguntas no encontrado." }, { status: 404 });

  try {
    const kind = set.processId ? "process" : set.moduleId ? "module" : "document";
    const refId = set.processId ?? set.moduleId ?? set.documentId!;
    const source = await buildSourceForGeneration(kind, refId);
    const result = await generateQuestionsForContent(source);

    const maxOrder = await prisma.learningPathQuestion.aggregate({ where: { setId }, _max: { order: true } });
    let nextOrder = (maxOrder._max.order ?? -1) + 1;
    const created = await prisma.$transaction(
      result.questions.map((q) =>
        prisma.learningPathQuestion.create({
          data: { setId, type: q.type, text: q.text, options: q.options, matchLeft: q.matchLeft, correctIndex: q.correctIndex, order: nextOrder++ },
        })
      )
    );
    return NextResponse.json(created, { status: 201 });
  } catch (err) {
    const message = err instanceof Error ? err.message : "No se pudieron generar preguntas.";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
