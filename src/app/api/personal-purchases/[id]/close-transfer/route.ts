import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { auth } from "@/auth";
import { canClosePersonalPurchaseTransfer } from "@/lib/guards";
import { sendPushToOwner } from "@/lib/webPush";

// Confirmado 2026-08-20: último paso — exclusivo de Nairoby/FIN, pedido
// explícito del usuario (el admin puede ver esta cola pero no cerrarla).
// A propósito NUNCA toca firstPayoutMonth: esa orden ya quedó pagada por
// transferencia, no debe generar ningún descuento en rol.
export async function POST(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  if (!(await canClosePersonalPurchaseTransfer())) return NextResponse.json({ error: "No autorizado." }, { status: 403 });

  const { id } = await params;
  const order = await prisma.personalPurchaseOrder.findUnique({ where: { id } });
  if (!order) return NextResponse.json({ error: "No encontrado." }, { status: 404 });
  if (order.status !== "PENDING_NAIROBY_CLOSE") return NextResponse.json({ error: "Todavía no está confirmada." }, { status: 409 });

  const session = await auth();
  const updated = await prisma.personalPurchaseOrder.update({
    where: { id },
    data: { status: "APPROVED", transferClosedAt: new Date(), transferClosedById: session!.user.id },
  });

  await sendPushToOwner(order.employeeId, {
    title: "🎉 Recibimos tu transferencia",
    body: `$${order.totalAmount?.toFixed(2)} — ¡disfrutá tu compra!`,
    url: "/area/compras-personales",
  }).catch(() => null);

  return NextResponse.json(updated);
}
