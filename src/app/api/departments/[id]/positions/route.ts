import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { auth } from "@/auth";
import { canManageNomina } from "@/lib/guards";

export async function GET(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const session = await auth();
  if (!session) return NextResponse.json({ error: "No autorizado." }, { status: 401 });
  if (session.user.role !== "admin" && !(await canManageNomina())) {
    return NextResponse.json({ error: "No autorizado." }, { status: 403 });
  }

  const { id } = await params;
  const positions = await prisma.position.findMany({ where: { deptId: id }, orderBy: { name: "asc" } });
  return NextResponse.json(positions);
}

const createSchema = z.object({
  name: z.string().trim().min(1, "Escribe un nombre para el puesto."),
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

  try {
    const position = await prisma.position.create({ data: { deptId: id, name: parsed.data.name } });
    return NextResponse.json(position, { status: 201 });
  } catch {
    return NextResponse.json({ error: "Ese puesto ya existe en esta área." }, { status: 409 });
  }
}
