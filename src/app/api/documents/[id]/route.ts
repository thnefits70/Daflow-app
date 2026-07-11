import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { requireAdminSession, canWriteLaws } from "@/lib/guards";

const updateSchema = z.object({
  title: z.string().trim().min(1).optional(),
  content: z.string().optional(),
  link: z.string().optional(),
  fileUrl: z.string().nullable().optional(),
  fileName: z.string().nullable().optional(),
});

export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const existing = await prisma.document.findUnique({ where: { id }, select: { isLaw: true } });
  if (!existing) return NextResponse.json({ error: "No encontrado." }, { status: 404 });

  const allowed = existing.isLaw ? await canWriteLaws() : !!(await requireAdminSession());
  if (!allowed) return NextResponse.json({ error: "No autorizado." }, { status: 403 });

  const body = await req.json().catch(() => null);
  const parsed = updateSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.issues[0]?.message ?? "Datos inválidos." }, { status: 400 });
  }

  const document = await prisma.document.update({ where: { id }, data: parsed.data });
  return NextResponse.json(document);
}

export async function DELETE(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const session = await requireAdminSession();
  if (!session) return NextResponse.json({ error: "No autorizado." }, { status: 403 });

  const { id } = await params;
  await prisma.document.delete({ where: { id } }).catch(() => null);
  return NextResponse.json({ ok: true });
}
