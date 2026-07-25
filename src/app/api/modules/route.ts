import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { auth } from "@/auth";
import { requireAdminSession } from "@/lib/guards";

export async function GET() {
  const session = await auth();
  if (!session) return NextResponse.json({ error: "No autorizado." }, { status: 401 });

  const modules = await prisma.module.findMany({
    orderBy: { order: "asc" },
    include: {
      _count: { select: { documents: true } },
      exam: { select: { id: true, _count: { select: { questions: true } } } },
    },
  });
  return NextResponse.json(
    modules.map((m) => ({
      id: m.id,
      title: m.title,
      imageUrl: m.imageUrl,
      order: m.order,
      documentCount: m._count.documents,
      examId: m.exam?.id ?? null,
      examQuestionCount: m.exam?._count.questions ?? 0,
    }))
  );
}

const createSchema = z.object({
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

  const maxOrder = await prisma.module.aggregate({ _max: { order: true } });
  const created = await prisma.module.create({
    data: { title: parsed.data.title, order: (maxOrder._max.order ?? -1) + 1 },
  });
  return NextResponse.json(created, { status: 201 });
}
