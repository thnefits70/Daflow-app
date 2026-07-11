import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { auth } from "@/auth";
import { requireAdminSession } from "@/lib/guards";

export async function GET(req: NextRequest) {
  const session = await auth();
  if (!session) return NextResponse.json({ error: "No autorizado." }, { status: 401 });

  const deptId = req.nextUrl.searchParams.get("deptId");
  if (!deptId) return NextResponse.json({ error: "Falta deptId." }, { status: 400 });
  if (session.user.role === "employee" && session.user.deptId !== deptId) {
    return NextResponse.json({ error: "No autorizado." }, { status: 403 });
  }

  const exams = await prisma.exam.findMany({
    where: { deptId },
    orderBy: { createdAt: "asc" },
    include: { _count: { select: { questions: true } } },
  });
  return NextResponse.json(
    exams.map((e) => ({ id: e.id, title: e.title, questionCount: e._count.questions }))
  );
}

const createSchema = z.object({
  deptId: z.string().min(1),
  title: z.string().trim().min(1, "El título es obligatorio."),
});

export async function POST(req: NextRequest) {
  const session = await requireAdminSession();
  if (!session) return NextResponse.json({ error: "No autorizado." }, { status: 403 });

  const body = await req.json().catch(() => null);
  const parsed = createSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.issues[0]?.message ?? "Datos inválidos." }, { status: 400 });
  }

  const exam = await prisma.exam.create({ data: { deptId: parsed.data.deptId, title: parsed.data.title } });
  return NextResponse.json(exam, { status: 201 });
}
