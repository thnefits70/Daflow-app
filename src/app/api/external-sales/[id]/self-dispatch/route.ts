import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { auth } from "@/auth";
import { prisma } from "@/lib/prisma";
import { canPackExternalSale } from "@/lib/guards";
import { createOutflowForExternalSale, notifyFinanceLeadExternalSaleReadyToClose } from "@/lib/externalSales";

const schema = z.object({ photoUrl: z.string().min(1) });

// Pedido explícito de Yair (2026-09-19, por audio): cuando él mismo hace el
// despacho — sin delegarlo a un colaborador de su equipo — antes tenía que
// asignarse la venta en la pestaña "Embalaje" y después ir a buscarla en
// "Mis entregas" para recién ahí tomar la foto y confirmar. Ese ir-y-venir
// entre pestañas era lo que él describía como "se queda pegada". Esta ruta
// junta assign-pack + deliver en un solo paso — mismo efecto real (dispara
// el mismo enganche a Egresos que deliver/route.ts), pero en un solo clic
// justo donde imprime la guía.
export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const session = await auth();
  if (!(await canPackExternalSale()) || !session) return NextResponse.json({ error: "No autorizado." }, { status: 403 });

  const { id } = await params;
  const body = await req.json().catch(() => null);
  const parsed = schema.safeParse(body);
  if (!parsed.success) return NextResponse.json({ error: "Falta la foto de la entrega." }, { status: 400 });

  const sale = await prisma.externalSale.findUnique({
    where: { id },
    select: {
      prepReadyAt: true,
      packAssignedToId: true,
      deliveredAt: true,
      paymentConfirmedAt: true,
      code: true,
      items: { select: { catalogItemId: true, declaredProductName: true, quantity: true } },
    },
  });
  if (!sale) return NextResponse.json({ error: "No encontrado." }, { status: 404 });
  if (!sale.prepReadyAt) return NextResponse.json({ error: "Inventario todavía no la deja lista." }, { status: 409 });
  if (sale.packAssignedToId) return NextResponse.json({ error: "Ya fue asignada a alguien." }, { status: 409 });
  if (sale.deliveredAt) return NextResponse.json({ error: "Ya fue entregada." }, { status: 409 });

  const updated = await prisma.externalSale.update({
    where: { id },
    data: {
      packAssignedToId: session.user.id,
      packAssignedAt: new Date(),
      packAssignedById: session.user.id,
      deliveryPhotoUrl: parsed.data.photoUrl,
      deliveredAt: new Date(),
      deliveredById: session.user.id,
    },
  });

  await createOutflowForExternalSale({ id, items: sale.items });
  if (sale.paymentConfirmedAt) await notifyFinanceLeadExternalSaleReadyToClose(sale.code);

  return NextResponse.json(updated);
}
