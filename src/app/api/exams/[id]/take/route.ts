import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { auth } from "@/auth";

export async function GET(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const session = await auth();
  if (!session) return NextResponse.json({ error: "No autorizado." }, { status: 401 });

  const { id } = await params;
  const exam = await prisma.exam.findUnique({
    where: { id },
    include: { questions: { orderBy: { order: "asc" } } },
  });
  if (!exam) return NextResponse.json({ error: "No encontrado." }, { status: 404 });

  if (session.user.role === "employee" && session.user.deptId !== exam.deptId) {
    return NextResponse.json({ error: "No autorizado." }, { status: 403 });
  }

  // Strip correct answers before sending to the client taking the exam.
  return NextResponse.json({
    id: exam.id,
    title: exam.title,
    questions: exam.questions.map((q) => ({ id: q.id, text: q.text, options: q.options })),
  });
}
