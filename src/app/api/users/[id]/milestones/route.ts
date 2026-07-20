import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { auth } from "@/auth";
import { canManageNomina } from "@/lib/guards";

const createSchema = z.object({
  title: z.string().trim().min(1, "Escribe un título para el hito."),
  note: z.string().trim().optional(),
});

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const session = await auth();
  if (!session) return NextResponse.json({ error: "No autorizado." }, { status: 401 });
  if (session.user.role !== "admin" && !(await canManageNomina())) {
    return NextResponse.json({ error: "No autorizado." }, { status: 403 });
  }

  const { id } = await params;
  const body = await req.json().catch(() => null);
  const parsed = createSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.issues[0]?.message ?? "Datos inválidos." }, { status: 400 });
  }

  const milestone = await prisma.milestone.create({
    data: { userId: id, title: parsed.data.title, note: parsed.data.note || null },
  });
  return NextResponse.json(milestone, { status: 201 });
}
