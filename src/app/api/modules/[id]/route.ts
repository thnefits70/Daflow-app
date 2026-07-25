import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { requireAdminSession } from "@/lib/guards";

const updateSchema = z.object({
  title: z.string().trim().min(1).optional(),
  imageUrl: z.string().nullable().optional(),
  imageName: z.string().nullable().optional(),
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

  const data: Record<string, unknown> = {};
  if (d.title !== undefined) data.title = d.title;
  if (d.imageUrl !== undefined) data.imageUrl = d.imageUrl;
  if (d.imageName !== undefined) data.imageName = d.imageName;

  const updated = await prisma.module.update({ where: { id }, data });
  return NextResponse.json(updated);
}

export async function DELETE(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const session = await requireAdminSession();
  if (!session) return NextResponse.json({ error: "No autorizado." }, { status: 403 });

  const { id } = await params;
  await prisma.module.delete({ where: { id } }).catch(() => null);
  return NextResponse.json({ ok: true });
}
