import { NextResponse } from "next/server";
import { auth } from "@/auth";
import { prisma } from "@/lib/prisma";
import { isFreightPayable, notifyPettyCashFreightPayable } from "@/lib/externalSales";
import { pendingPickups } from "@/lib/localWarranty";

// Confirmado 2026-09-22, pedido de Marcos (aprobado por el usuario): SOLO el
// asesor dueño de la venta confirma que el cliente recibió el pedido — es
// quien habla con el motorizado/cliente. No toca stock (eso ya pasó en
// /deliver); solo habilita el pago del flete al motorizado desde Caja Chica
// y avisa a Nairoby/Jariel (ver notifyPettyCashFreightPayable).
export async function POST(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const session = await auth();
  if (!session) return NextResponse.json({ error: "No autorizado." }, { status: 403 });

  const { id } = await params;
  const sale = await prisma.externalSale.findUnique({
    where: { id },
    select: {
      advisorId: true, code: true, pickupPersonName: true, deliveredAt: true, returnedAt: true, deletedAt: true, clientReceivedAt: true,
      isContraEntrega: true, freightCost: true, paymentConfirmedAt: true, freightPaidAt: true, kind: true,
      items: { select: { warrantyRole: true, pickupReceivedAt: true } },
    },
  });
  if (!sale) return NextResponse.json({ error: "No encontrado." }, { status: 404 });
  if (sale.advisorId !== session.user.id) return NextResponse.json({ error: "No autorizado." }, { status: 403 });
  if (sale.deletedAt) return NextResponse.json({ error: "Esta venta fue cancelada." }, { status: 409 });
  if (!sale.deliveredAt) return NextResponse.json({ error: "Bodega todavía no le entregó el pedido al motorizado." }, { status: 409 });
  if (sale.returnedAt) return NextResponse.json({ error: "Esta venta ya se reportó como no recibida." }, { status: 409 });
  if (sale.clientReceivedAt) return NextResponse.json({ error: "Ya confirmaste que el cliente lo recibió." }, { status: 409 });
  // Garantía local (2026-10-02): si el motorizado tenía que traer algo,
  // bodega confirma primero que llegó — así no se paga un flete de algo que
  // nunca volvió.
  if (sale.kind === "WARRANTY" && pendingPickups(sale.items) > 0) {
    return NextResponse.json({ error: "Bodega todavía no confirma que recibió lo que el motorizado tenía que traer." }, { status: 409 });
  }

  const clientReceivedAt = new Date();
  const updated = await prisma.externalSale.update({ where: { id }, data: { clientReceivedAt } });

  if (isFreightPayable({ ...sale, clientReceivedAt })) {
    await notifyPettyCashFreightPayable({ code: sale.code, pickupPersonName: sale.pickupPersonName, freightCost: sale.freightCost!, excludeUserId: sale.kind === "WARRANTY" ? sale.advisorId : null });
  }

  return NextResponse.json(updated);
}
