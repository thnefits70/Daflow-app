import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { requireAdminSession } from "@/lib/guards";

const createSchema = z.object({
  type: z.enum(["MULTIPLE_CHOICE", "TRUE_FALSE", "MATCHING", "SHORT_ANSWER"]),
  text: z.string().trim().min(1, "La pregunta es obligatoria."),
  options: z.array(z.string()).default([]),
  matchLeft: z.array(z.string()).default([]),
  correctIndex: z.number().int().nullable().default(null),
});

export async function POST(req: NextRequest, { params }: { params: Promise<{ setId: string }> }) {
  const session = await requireAdminSession();
  if (!session) return NextResponse.json({ error: "No autorizado." }, { status: 403 });

  const { setId } = await params;
  const body = await req.json().catch(() => null);
  const parsed = createSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.issues[0]?.message ?? "Datos inválidos." }, { status: 400 });
  }

  const maxOrder = await prisma.learningPathQuestion.aggregate({ where: { setId }, _max: { order: true } });
  const created = await prisma.learningPathQuestion.create({
    data: { setId, ...parsed.data, order: (maxOrder._max.order ?? -1) + 1 },
  });
  return NextResponse.json(created, { status: 201 });
}
