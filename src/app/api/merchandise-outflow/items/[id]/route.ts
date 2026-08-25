import { NextResponse } from "next/server";
import { auth } from "@/auth";
import { prisma } from "@/lib/prisma";
import { canCaptureMerchandiseOutflow } from "@/lib/guards";

// Quitar un renglón del lote mientras sigue en borrador — solo quien lo creó.
export async function DELETE(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const session = await auth();
  if (!(await canCaptureMerchandiseOutflow()) || !session) return NextResponse.json({ error: "No autorizado." }, { status: 403 });

  const { id } = await params;
  const item = await prisma.merchandiseOutflowItem.findUnique({ where: { id }, include: { batch: { select: { createdById: true, submittedAt: true } } } });
  if (!item) return NextResponse.json({ error: "No encontrado." }, { status: 404 });
  if (item.batch.createdById !== session.user.id) return NextResponse.json({ error: "No autorizado." }, { status: 403 });
  if (item.batch.submittedAt) return NextResponse.json({ error: "Este lote ya fue enviado." }, { status: 409 });

  await prisma.merchandiseOutflowItem.delete({ where: { id } });
  return NextResponse.json({ ok: true });
}
