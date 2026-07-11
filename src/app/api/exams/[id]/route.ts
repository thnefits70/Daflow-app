import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { requireAdminSession } from "@/lib/guards";

export async function GET(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const session = await requireAdminSession();
  if (!session) return NextResponse.json({ error: "No autorizado." }, { status: 403 });

  const { id } = await params;
  const exam = await prisma.exam.findUnique({
    where: { id },
    include: {
      questions: { orderBy: { order: "asc" } },
      scores: { orderBy: { createdAt: "desc" } },
    },
  });
  if (!exam) return NextResponse.json({ error: "No encontrado." }, { status: 404 });
  return NextResponse.json(exam);
}

const questionSchema = z.object({
  text: z.string().trim().min(1),
  options: z.array(z.string().trim().min(1)).min(2),
  correctIndex: z.number().int().min(0),
});

const updateSchema = z.object({
  title: z.string().trim().min(1).optional(),
  questions: z.array(questionSchema).optional(),
});

export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const session = await requireAdminSession();
  if (!session) return NextResponse.json({ error: "No autorizado." }, { status: 403 });

  const { id } = await params;
  const body = await req.json().catch(() => null);
  const parsed = updateSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.issues[0]?.message ?? "Datos inválidos." }, { status: 400 });
  }
  const d = parsed.data;

  await prisma.$transaction(async (tx) => {
    if (d.title !== undefined) {
      await tx.exam.update({ where: { id }, data: { title: d.title } });
    }
    if (d.questions !== undefined) {
      await tx.examQuestion.deleteMany({ where: { examId: id } });
      if (d.questions.length > 0) {
        await tx.examQuestion.createMany({
          data: d.questions.map((q, index) => ({
            examId: id,
            text: q.text,
            options: q.options,
            correctIndex: q.correctIndex,
            order: index,
          })),
        });
      }
    }
  });

  return NextResponse.json({ ok: true });
}

export async function DELETE(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const session = await requireAdminSession();
  if (!session) return NextResponse.json({ error: "No autorizado." }, { status: 403 });

  const { id } = await params;
  await prisma.exam.delete({ where: { id } }).catch(() => null);
  return NextResponse.json({ ok: true });
}
