import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { requireAdminSession, canEditDeptKpis } from "@/lib/guards";

const updateSchema = z.object({
  problem: z.string().trim().min(1).optional(),
  actionPlan: z.string().trim().min(1).optional(),
  status: z.enum(["PENDING", "RESOLVED", "REJECTED"]).optional(),
});

const statusOnlySchema = z.object({ status: z.enum(["PENDING", "RESOLVED", "REJECTED"]) });

export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const isAdmin = !!(await requireAdminSession());

  const existing = await prisma.weeklyReviewRecord.findUnique({ where: { id }, select: { deptId: true } });
  if (!existing) return NextResponse.json({ error: "No encontrado." }, { status: 404 });

  const body = await req.json().catch(() => null);

  if (isAdmin) {
    const parsed = updateSchema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json({ error: parsed.error.issues[0]?.message ?? "Datos inválidos." }, { status: 400 });
    }
    const record = await prisma.weeklyReviewRecord.update({ where: { id }, data: parsed.data });
    return NextResponse.json(record);
  }

  // No es admin: el líder del área puede cambiar SOLO el estado de los
  // registros de su propio departamento (crear/editar contenido/eliminar
  // sigue siendo exclusivo del admin) — canEditDeptKpis ya resuelve
  // exactamente "admin o líder de este deptId", reusado tal cual.
  if (!(await canEditDeptKpis(existing.deptId))) {
    return NextResponse.json({ error: "No autorizado." }, { status: 403 });
  }
  const parsed = statusOnlySchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.issues[0]?.message ?? "Datos inválidos." }, { status: 400 });
  }
  const record = await prisma.weeklyReviewRecord.update({ where: { id }, data: { status: parsed.data.status } });
  return NextResponse.json(record);
}

export async function DELETE(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  if (!(await requireAdminSession())) {
    return NextResponse.json({ error: "No autorizado." }, { status: 403 });
  }
  const { id } = await params;

  await prisma.weeklyReviewRecord.delete({ where: { id } }).catch(() => null);
  return NextResponse.json({ ok: true });
}
