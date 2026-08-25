import { NextResponse } from "next/server";
import { auth } from "@/auth";
import { prisma } from "@/lib/prisma";
import { canConfirmCancelledGuideFulfillment } from "@/lib/guards";

// Cualquiera de Fulfillment confirma que hizo su gestión (no despachar) —
// un solo botón, sin más detalle que pedir.
export async function POST(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const session = await auth();
  if (!(await canConfirmCancelledGuideFulfillment()) || !session) return NextResponse.json({ error: "No autorizado." }, { status: 403 });

  const { id } = await params;
  const report = await prisma.cancelledGuideReport.findUnique({ where: { id }, select: { fulfillmentConfirmedAt: true } });
  if (!report) return NextResponse.json({ error: "No encontrado." }, { status: 404 });
  if (report.fulfillmentConfirmedAt) return NextResponse.json({ error: "Ya fue confirmado." }, { status: 409 });

  const updated = await prisma.cancelledGuideReport.update({
    where: { id },
    data: { fulfillmentConfirmedAt: new Date(), fulfillmentConfirmedById: session.user.id },
  });
  return NextResponse.json(updated);
}
