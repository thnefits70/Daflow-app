import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { canConfirmPersonalPurchaseTransfer } from "@/lib/guards";
import { notifyOwner } from "@/lib/notifications";

// Confirmado 2026-08-20: el "segundo paso" de la confirmación (revisar tu
// banco real y confirmar dos veces) vive en el cliente como un modal — este
// endpoint es lo que dispara el botón final de ese modal. Exclusivo del
// admin (canConfirmPersonalPurchaseTransfer). No toca firstPayoutMonth.
//
// Confirmado 2026-09-29: pedido del usuario — la confirmación del admin YA
// CIERRA la operación (antes quedaba en PENDING_NAIROBY_CLOSE esperando un
// clic de Nairoby que no revisaba nada nuevo). A cambio, solo se puede
// confirmar si la IA leyó en el comprobante el monto EXACTO del total: el
// admin garantiza que la plata llegó, la IA que el monto es el correcto. Si
// no coincide, el admin pide otro comprobante (reject-transfer-proof).
export async function POST(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  if (!(await canConfirmPersonalPurchaseTransfer())) return NextResponse.json({ error: "No autorizado." }, { status: 403 });

  const { id } = await params;
  const order = await prisma.personalPurchaseOrder.findUnique({ where: { id }, include: { employee: { select: { name: true } } } });
  if (!order) return NextResponse.json({ error: "No encontrado." }, { status: 404 });
  if (order.status !== "PENDING_ADMIN_CONFIRM") return NextResponse.json({ error: "Ya fue procesado." }, { status: 409 });
  if (order.transferAiMatch !== true) {
    return NextResponse.json({ error: "La IA no confirmó que el comprobante diga el monto exacto. Pide otro comprobante." }, { status: 409 });
  }

  const now = new Date();
  const updated = await prisma.personalPurchaseOrder.update({
    where: { id },
    data: {
      status: "APPROVED",
      transferAdminConfirmedAt: now,
      transferAdminConfirmedById: null,
      transferClosedAt: now,
      transferClosedById: null,
    },
  });

  await notifyOwner(order.employeeId, {
    title: "🎉 Recibimos tu transferencia",
    body: `$${order.totalAmount?.toFixed(2)} — ¡disfrutá tu compra!`,
    url: "/area/compras-personales",
  });

  const finLeader = await prisma.user.findFirst({ where: { isLeader: true, leadsDept: { code: "FIN" } }, select: { id: true } });
  if (finLeader) {
    await notifyOwner(finLeader.id, {
      title: "🏦 Transferencia recibida y cerrada",
      body: `${order.employee.name} — $${order.totalAmount?.toFixed(2)} · el admin confirmó que llegó, ya quedó cerrada`,
      url: "/area/nomina?tab=pagos&ptab=comprasfinanzas",
    });
  }

  return NextResponse.json(updated);
}
