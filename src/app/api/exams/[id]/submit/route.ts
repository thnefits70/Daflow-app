import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { auth } from "@/auth";

const schema = z.object({
  answers: z.record(z.string(), z.number().int()),
});

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const session = await auth();
  if (!session) return NextResponse.json({ error: "No autorizado." }, { status: 401 });

  const { id } = await params;
  const body = await req.json().catch(() => null);
  const parsed = schema.safeParse(body);
  if (!parsed.success) return NextResponse.json({ error: "Datos inválidos." }, { status: 400 });

  const exam = await prisma.exam.findUnique({ where: { id }, include: { questions: true } });
  if (!exam) return NextResponse.json({ error: "No encontrado." }, { status: 404 });

  if (session.user.role === "employee" && session.user.deptId !== exam.deptId) {
    return NextResponse.json({ error: "No autorizado." }, { status: 403 });
  }

  const total = exam.questions.length;
  const score = exam.questions.reduce(
    (acc, q) => acc + (parsed.data.answers[q.id] === q.correctIndex ? 1 : 0),
    0
  );

  const userName = session.user.role === "admin" ? "Administrador" : session.user.name ?? "Sin nombre";
  const examScore = await prisma.examScore.create({
    data: {
      examId: id,
      userId: session.user.role === "employee" ? session.user.id : null,
      userName,
      score,
      total,
    },
  });

  return NextResponse.json({ score, total, id: examScore.id });
}
