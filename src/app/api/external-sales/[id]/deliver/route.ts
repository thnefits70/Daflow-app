import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { auth } from "@/auth";
import { prisma } from "@/lib/prisma";
import { canCaptureMerchandiseOutflow, canActOnMerchandiseOutflow } from "@/lib/guards";
import { createOutflowForExternalSale, notifyFinanceLeadExternalSaleReadyToClose } from "@/lib/externalSales";

const schema = z.object({ photoUrl: z.string().min(1) });

// El colaborador asignado (o Daniel, como respaldo) confirma la entrega —
// acá es cuando el stock sale de verdad, así que dispara el enganche
// automático a Registro de Egresos.
export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const session = await auth();
  if (!session || !(await canCaptureMerchandiseOutflow())) return NextResponse.json({ error: "No autorizado." }, { status: 403 });

  const { id } = await params;
  const body = await req.json().catch(() => null);
  const parsed = schema.safeParse(body);
  if (!parsed.success) return NextResponse.json({ error: "Falta la foto de la entrega." }, { status: 400 });

  const sale = await prisma.externalSale.findUnique({
    where: { id },
    select: { dispatchAssignedToId: true, deliveredAt: true, paymentConfirmedAt: true, code: true, catalogItemId: true, declaredProductName: true, quantity: true },
  });
  if (!sale) return NextResponse.json({ error: "No encontrado." }, { status: 404 });
  const isAssignee = sale.dispatchAssignedToId === session.user.id;
  if (!isAssignee && !(await canActOnMerchandiseOutflow())) return NextResponse.json({ error: "No autorizado." }, { status: 403 });
  if (!sale.dispatchAssignedToId) return NextResponse.json({ error: "Todavía no se asigna el despacho." }, { status: 409 });
  if (sale.deliveredAt) return NextResponse.json({ error: "Ya fue entregada." }, { status: 409 });

  const updated = await prisma.externalSale.update({
    where: { id },
    data: { deliveryPhotoUrl: parsed.data.photoUrl, deliveredAt: new Date(), deliveredById: session.user.id },
  });

  await createOutflowForExternalSale({ id, catalogItemId: sale.catalogItemId, declaredProductName: sale.declaredProductName, quantity: sale.quantity });
  if (sale.paymentConfirmedAt) await notifyFinanceLeadExternalSaleReadyToClose(sale.code);

  return NextResponse.json(updated);
}
