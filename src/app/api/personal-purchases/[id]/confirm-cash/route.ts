import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { auth } from "@/auth";
import { canClosePersonalPurchaseTransfer } from "@/lib/guards";
import { getOrCreateBox } from "@/lib/pettyCash";
import { sendPushToOwner } from "@/lib/webPush";

// Confirmado 2026-09-07: un solo clic de Nairoby/FIN — ella entregó el
// efectivo en mano, así que su propio clic YA es la confirmación de
// recepción. A diferencia de una recarga normal (que queda pendiente hasta
// que alguien más la confirma), acá se crea la PettyCashEntry con
// confirmedAt ya puesto, para que el saldo suba al instante y nadie tenga
// que cargarla de nuevo a mano. Mismo guard exclusivo que cierra
// transferencias — ni admin tiene bypass acá.
export async function POST(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  if (!(await canClosePersonalPurchaseTransfer())) return NextResponse.json({ error: "No autorizado." }, { status: 403 });

  const { id } = await params;
  const order = await prisma.personalPurchaseOrder.findUnique({ where: { id }, include: { employee: { select: { name: true } } } });
  if (!order) return NextResponse.json({ error: "No encontrado." }, { status: 404 });
  if (order.status !== "PENDING_CASH_CONFIRM") return NextResponse.json({ error: "Ya fue procesado." }, { status: 409 });
  if (order.totalAmount == null) return NextResponse.json({ error: "Falta el monto de la compra." }, { status: 409 });

  const session = await auth();
  const box = await getOrCreateBox("PRINCIPAL");

  const updated = await prisma.$transaction(async (tx) => {
    const entry = await tx.pettyCashEntry.create({
      data: {
        boxId: box.id,
        kind: "RECARGA",
        amount: order.totalAmount!,
        description: `Efectivo — compra personal de ${order.employee.name}`,
        confirmedAt: new Date(),
        confirmedById: session!.user.id,
        createdById: session!.user.id,
        updatedById: session!.user.id,
      },
    });

    return tx.personalPurchaseOrder.update({
      where: { id },
      data: { status: "APPROVED", cashConfirmedAt: new Date(), cashConfirmedById: session!.user.id, cashPettyCashEntryId: entry.id },
    });
  });

  await sendPushToOwner(order.employeeId, {
    title: "🎉 Recibimos tu pago en efectivo",
    body: `$${order.totalAmount?.toFixed(2)} — ¡disfrutá tu compra!`,
    url: "/area/compras-personales",
  }).catch(() => null);

  return NextResponse.json(updated);
}
