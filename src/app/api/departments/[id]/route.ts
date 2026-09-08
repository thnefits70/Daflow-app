import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { requireAdminSession } from "@/lib/guards";
import { verifyAdminStepUp } from "@/lib/adminStepUp";

const deleteSchema = z.object({
  confirmName: z.string(),
  password: z.string(),
  code: z.string().optional(),
});

// Eliminar un área es irreversible en cuanto a impacto (todo lo que cuelga de
// ella, ver onDelete: Cascade en el schema), así que en vez de borrar de una
// se pide: nombre exacto escrito a mano + contraseña de admin + código del
// autenticador (si está activado) — y aun cumpliendo todo eso, solo se marca
// deletedAt (recuperable) en vez de borrar la fila.
export async function DELETE(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const session = await requireAdminSession();
  if (!session) return NextResponse.json({ error: "No autorizado." }, { status: 403 });

  const { id } = await params;
  const body = await req.json().catch(() => null);
  const parsed = deleteSchema.safeParse(body);
  if (!parsed.success) return NextResponse.json({ error: "Datos inválidos." }, { status: 400 });

  const department = await prisma.department.findUnique({ where: { id } });
  if (!department || department.deletedAt) {
    return NextResponse.json({ error: "El área no existe o ya fue eliminada." }, { status: 404 });
  }

  if (parsed.data.confirmName.trim() !== department.name) {
    return NextResponse.json({ error: "El nombre no coincide con el del área." }, { status: 400 });
  }

  const stepUp = await verifyAdminStepUp(parsed.data.password, parsed.data.code);
  if (!stepUp.ok) return NextResponse.json({ error: stepUp.error }, { status: 401 });

  const activeUsers = await prisma.user.count({ where: { deptId: id, isActive: true } });
  if (activeUsers > 0) {
    return NextResponse.json(
      {
        error: `No se puede eliminar: hay ${activeUsers} persona${activeUsers === 1 ? "" : "s"} activa${activeUsers === 1 ? "" : "s"} en esta área. Reasígnalas o desactívalas primero.`,
      },
      { status: 409 },
    );
  }

  await prisma.department.update({ where: { id }, data: { deletedAt: new Date() } });
  return NextResponse.json({ ok: true });
}
