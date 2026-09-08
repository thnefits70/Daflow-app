import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireAdminSession } from "@/lib/guards";

// Restaurar no es destructivo (deshace un borrado lógico), así que no pide
// el mismo paso extra de contraseña + código que sí pide DELETE.
export async function POST(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const session = await requireAdminSession();
  if (!session) return NextResponse.json({ error: "No autorizado." }, { status: 403 });

  const { id } = await params;
  const department = await prisma.department.findUnique({ where: { id } });
  if (!department || !department.deletedAt) {
    return NextResponse.json({ error: "El área no existe o no está eliminada." }, { status: 404 });
  }

  await prisma.department.update({ where: { id }, data: { deletedAt: null } });
  return NextResponse.json({ ok: true });
}
