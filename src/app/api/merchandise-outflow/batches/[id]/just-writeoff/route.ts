import { NextResponse } from "next/server";
import { auth } from "@/auth";
import { prisma } from "@/lib/prisma";
import { canActOnMerchandiseOutflow } from "@/lib/guards";

// Confirmación humana reforzada de que Daniel ya hizo la baja de verdad en
// Just (sistema externo, sin integración) — exclusivo del líder de
// Inventario, ni siquiera admin, mismo criterio que canActOnMerchandiseReentry.
export async function POST(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const session = await auth();
  if (!(await canActOnMerchandiseOutflow()) || !session) return NextResponse.json({ error: "No autorizado." }, { status: 403 });

  const { id } = await params;
  const batch = await prisma.merchandiseOutflowBatch.findUnique({ where: { id }, select: { submittedAt: true, justWrittenOffAt: true } });
  if (!batch) return NextResponse.json({ error: "No encontrado." }, { status: 404 });
  if (!batch.submittedAt) return NextResponse.json({ error: "Este lote todavía no está listo." }, { status: 409 });
  if (batch.justWrittenOffAt) return NextResponse.json({ error: "Ya fue dado de baja." }, { status: 409 });

  const updated = await prisma.merchandiseOutflowBatch.update({
    where: { id },
    data: { justWrittenOffAt: new Date(), justWrittenOffById: session.user.id },
  });
  return NextResponse.json(updated);
}
