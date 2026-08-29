import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { auth } from "@/auth";
import { prisma } from "@/lib/prisma";
import { canPackExternalSale, canAssignExternalSalePack } from "@/lib/guards";
import { createOutflowForExternalSale, notifyFinanceLeadExternalSaleReadyToClose } from "@/lib/externalSales";

const schema = z.object({ photoUrl: z.string().min(1) });

// El colaborador de Fulfilment asignado por Yair (o Yair, como respaldo)
// confirma la entrega al motorizado — foto en tiempo real, nunca un
// archivo subido. Acá es cuando el stock sale de verdad, así que dispara
// el enganche automático a Registro de Egresos.
export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const session = await auth();
  if (!session || !(await canPackExternalSale())) return NextResponse.json({ error: "No autorizado." }, { status: 403 });

  const { id } = await params;
  const body = await req.json().catch(() => null);
  const parsed = schema.safeParse(body);
  if (!parsed.success) return NextResponse.json({ error: "Falta la foto de la entrega." }, { status: 400 });

  const sale = await prisma.externalSale.findUnique({
    where: { id },
    select: { packAssignedToId: true, deliveredAt: true, paymentConfirmedAt: true, code: true, catalogItemId: true, declaredProductName: true, quantity: true },
  });
  if (!sale) return NextResponse.json({ error: "No encontrado." }, { status: 404 });
  const isAssignee = sale.packAssignedToId === session.user.id;
  if (!isAssignee && !(await canAssignExternalSalePack())) return NextResponse.json({ error: "No autorizado." }, { status: 403 });
  if (!sale.packAssignedToId) return NextResponse.json({ error: "Todavía no se asigna quién embala." }, { status: 409 });
  if (sale.deliveredAt) return NextResponse.json({ error: "Ya fue entregada." }, { status: 409 });

  const updated = await prisma.externalSale.update({
    where: { id },
    data: { deliveryPhotoUrl: parsed.data.photoUrl, deliveredAt: new Date(), deliveredById: session.user.id },
  });

  await createOutflowForExternalSale({ id, catalogItemId: sale.catalogItemId, declaredProductName: sale.declaredProductName, quantity: sale.quantity });
  if (sale.paymentConfirmedAt) await notifyFinanceLeadExternalSaleReadyToClose(sale.code);

  return NextResponse.json(updated);
}
