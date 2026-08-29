import { NextResponse } from "next/server";
import { auth } from "@/auth";
import { prisma } from "@/lib/prisma";
import { canCloseExternalSale } from "@/lib/guards";
import { notifyEveryoneExternalSaleClosed } from "@/lib/externalSales";

// Nairoby cierra con el valor completo y toda la trazabilidad — solo
// posible cuando pago y despacho ya están resueltos, sin importar el orden.
export async function POST(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const session = await auth();
  if (!(await canCloseExternalSale()) || !session) return NextResponse.json({ error: "No autorizado." }, { status: 403 });

  const { id } = await params;
  const sale = await prisma.externalSale.findUnique({
    where: { id },
    select: {
      paymentConfirmedAt: true,
      deliveredAt: true,
      nairobyClosedAt: true,
      code: true,
      advisorId: true,
      reviewedById: true,
      invoiceUploadedById: true,
      dispatchAssignedToId: true,
      packAssignedToId: true,
      deliveredById: true,
    },
  });
  if (!sale) return NextResponse.json({ error: "No encontrado." }, { status: 404 });
  if (!sale.paymentConfirmedAt || !sale.deliveredAt) return NextResponse.json({ error: "Falta confirmar el pago y/o la entrega." }, { status: 409 });
  if (sale.nairobyClosedAt) return NextResponse.json({ error: "Ya fue cerrada." }, { status: 409 });

  const updated = await prisma.externalSale.update({
    where: { id },
    data: { nairobyClosedAt: new Date(), nairobyClosedById: session.user.id },
  });

  await notifyEveryoneExternalSaleClosed(sale);
  return NextResponse.json(updated);
}
