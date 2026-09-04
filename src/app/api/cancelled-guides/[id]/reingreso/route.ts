import { NextResponse } from "next/server";
import { auth } from "@/auth";
import { prisma } from "@/lib/prisma";
import { canActOnMerchandiseOutflow } from "@/lib/guards";

// Daniel reingresa a Just — confirmación humana reforzada, exclusivo de él
// (ni siquiera admin, mismo criterio que el resto de acciones de Egresos).
export async function POST(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const session = await auth();
  if (!(await canActOnMerchandiseOutflow()) || !session) return NextResponse.json({ error: "No autorizado." }, { status: 403 });

  const { id } = await params;
  const report = await prisma.cancelledGuideReport.findUnique({ where: { id }, select: { batchManagedAt: true, fulfillmentRemovedAt: true, itemsAssignedAt: true, reingresadoAt: true } });
  if (!report) return NextResponse.json({ error: "No encontrado." }, { status: 404 });
  if (!report.itemsAssignedAt) return NextResponse.json({ error: "Esta guía todavía no tiene productos cargados." }, { status: 409 });
  if (!report.batchManagedAt) return NextResponse.json({ error: "Bryan todavía no gestionó esta guía con la transportadora." }, { status: 409 });
  if (!report.fulfillmentRemovedAt) return NextResponse.json({ error: "Yair todavía no confirmó que sacó esta guía de Fulfillment." }, { status: 409 });
  if (report.reingresadoAt) return NextResponse.json({ error: "Ya fue reingresada." }, { status: 409 });

  const updated = await prisma.cancelledGuideReport.update({
    where: { id },
    data: { reingresadoAt: new Date(), reingresadoById: session.user.id },
  });
  return NextResponse.json(updated);
}
