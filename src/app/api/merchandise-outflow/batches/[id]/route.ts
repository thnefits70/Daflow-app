import { NextResponse } from "next/server";
import { auth } from "@/auth";
import { prisma } from "@/lib/prisma";
import { canCaptureMerchandiseOutflow } from "@/lib/guards";

// Eliminar el lote entero (y sus productos, por cascada) — solo mientras
// sigue en borrador y solo quien lo creó.
export async function DELETE(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const session = await auth();
  if (!(await canCaptureMerchandiseOutflow()) || !session) return NextResponse.json({ error: "No autorizado." }, { status: 403 });

  const { id } = await params;
  const batch = await prisma.merchandiseOutflowBatch.findUnique({ where: { id }, select: { createdById: true, submittedAt: true } });
  if (!batch) return NextResponse.json({ error: "No encontrado." }, { status: 404 });
  if (batch.createdById !== session.user.id) return NextResponse.json({ error: "No autorizado." }, { status: 403 });
  if (batch.submittedAt) return NextResponse.json({ error: "Este lote ya fue enviado — no se puede eliminar." }, { status: 409 });

  await prisma.merchandiseOutflowBatch.delete({ where: { id } });
  return NextResponse.json({ ok: true });
}
