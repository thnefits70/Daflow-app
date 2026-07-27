import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { requireAdminSession } from "@/lib/guards";

const updateSchema = z.object({
  type: z.enum(["MULTIPLE_CHOICE", "TRUE_FALSE", "MATCHING", "SHORT_ANSWER"]).optional(),
  text: z.string().trim().min(1).optional(),
  options: z.array(z.string()).optional(),
  matchLeft: z.array(z.string()).optional(),
  correctIndex: z.number().int().nullable().optional(),
});

export async function PATCH(req: NextRequest, { params }: { params: Promise<{ questionId: string }> }) {
  const session = await requireAdminSession();
  if (!session) return NextResponse.json({ error: "No autorizado." }, { status: 403 });

  const { questionId } = await params;
  const body = await req.json().catch(() => null);
  const parsed = updateSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.issues[0]?.message ?? "Datos inválidos." }, { status: 400 });
  }

  const updated = await prisma.learningPathQuestion.update({ where: { id: questionId }, data: parsed.data });
  return NextResponse.json(updated);
}

export async function DELETE(_req: NextRequest, { params }: { params: Promise<{ questionId: string }> }) {
  const session = await requireAdminSession();
  if (!session) return NextResponse.json({ error: "No autorizado." }, { status: 403 });

  const { questionId } = await params;
  await prisma.learningPathQuestion.delete({ where: { id: questionId } }).catch(() => null);
  return NextResponse.json({ ok: true });
}
