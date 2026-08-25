import { NextResponse } from "next/server";
import { auth } from "@/auth";
import { prisma } from "@/lib/prisma";
import { canCaptureMerchandiseOutflow } from "@/lib/guards";
import { notifyInventoryLeadOutflowPending } from "@/lib/merchandiseOutflow";

// Congela el lote de despacho/garantía — a partir de acá ya no se puede
// editar, y queda listo en la cola de "dar de baja en Just".
export async function POST(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const session = await auth();
  if (!(await canCaptureMerchandiseOutflow()) || !session) return NextResponse.json({ error: "No autorizado." }, { status: 403 });

  const { id } = await params;
  const batch = await prisma.merchandiseOutflowBatch.findUnique({ where: { id }, include: { items: { select: { id: true } } } });
  if (!batch) return NextResponse.json({ error: "No encontrado." }, { status: 404 });
  if (batch.createdById !== session.user.id) return NextResponse.json({ error: "No autorizado." }, { status: 403 });
  if (batch.submittedAt) return NextResponse.json({ error: "Este lote ya fue enviado." }, { status: 409 });
  if (batch.items.length === 0) return NextResponse.json({ error: "Agrega al menos un producto antes de enviar." }, { status: 409 });

  const updated = await prisma.merchandiseOutflowBatch.update({ where: { id }, data: { submittedAt: new Date() } });
  await notifyInventoryLeadOutflowPending(updated);
  return NextResponse.json(updated);
}
