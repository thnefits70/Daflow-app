import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { auth } from "@/auth";
import { prisma } from "@/lib/prisma";
import { canAssignExternalSalePack, canDeclareExternalSales } from "@/lib/guards";
import { createOutflowForExternalSale, notifyFinanceLeadExternalSaleReadyToClose } from "@/lib/externalSales";

const schema = z.object({ photoUrl: z.string().min(1).optional() });

// El colaborador de Fulfilment asignado por Yair (o Yair, como respaldo)
// confirma la entrega al motorizado — foto en tiempo real, nunca un
// archivo subido. Acá es cuando el stock sale de verdad, así que dispara
// el enganche automático a Registro de Egresos.
// Confirmado 2026-09-15, pedido explícito de Marcos: para ventas donde ÉL
// coordina su propio motorizado (sin pasar por el equipo de Fulfilment),
// el asesor dueño de la venta puede confirmar la entrega directo acá mismo
// — mismo efecto real (dispara el mismo enganche a Egresos), pero sin
// exigir que antes se haya asignado quién embala, y con foto OPCIONAL
// (la que el motorizado le manda por fuera, no una captura en vivo).
export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const session = await auth();
  if (!session) return NextResponse.json({ error: "No autorizado." }, { status: 403 });

  const { id } = await params;
  const body = await req.json().catch(() => null);
  const parsed = schema.safeParse(body);
  if (!parsed.success) return NextResponse.json({ error: "Datos inválidos." }, { status: 400 });

  const sale = await prisma.externalSale.findUnique({
    where: { id },
    select: {
      packAssignedToId: true,
      deliveredAt: true,
      paymentConfirmedAt: true,
      advisorId: true,
      code: true,
      items: { select: { catalogItemId: true, declaredProductName: true, quantity: true } },
    },
  });
  if (!sale) return NextResponse.json({ error: "No encontrado." }, { status: 404 });

  const isAssignee = sale.packAssignedToId === session.user.id;
  const isFulfillmentLead = await canAssignExternalSalePack();
  const isOwnAdvisor = sale.advisorId === session.user.id && (await canDeclareExternalSales());

  if (!isAssignee && !isFulfillmentLead && !isOwnAdvisor) {
    return NextResponse.json({ error: "No autorizado." }, { status: 403 });
  }
  // El requisito de "ya se asignó quién embala" solo aplica al camino
  // normal de Fulfillment — el propio asesor puede confirmar directo
  // (motorizado propio), sin pasar por esa asignación.
  if (!isOwnAdvisor && !sale.packAssignedToId) {
    return NextResponse.json({ error: "Todavía no se asigna quién embala." }, { status: 409 });
  }
  if (!isOwnAdvisor && !parsed.data.photoUrl) {
    return NextResponse.json({ error: "Falta la foto de la entrega." }, { status: 400 });
  }
  if (sale.deliveredAt) return NextResponse.json({ error: "Ya fue entregada." }, { status: 409 });

  const updated = await prisma.externalSale.update({
    where: { id },
    data: { deliveryPhotoUrl: parsed.data.photoUrl ?? null, deliveredAt: new Date(), deliveredById: session.user.id },
  });

  await createOutflowForExternalSale({ id, items: sale.items });
  if (sale.paymentConfirmedAt) await notifyFinanceLeadExternalSaleReadyToClose(sale.code);

  return NextResponse.json(updated);
}
