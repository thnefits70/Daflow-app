import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { auth } from "@/auth";
import { canConfirmPersonalPurchaseFinance } from "@/lib/guards";
import { sendPushToOwner } from "@/lib/webPush";

// Confirmado 2026-08-20: último paso — Nairoby (o admin) cierra la
// operación una vez que el admin ya confirmó que la plata llegó a la
// cuenta real. A propósito NUNCA toca firstPayoutMonth: esa orden ya quedó
// pagada por transferencia, no debe generar ningún descuento en rol.
export async function POST(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  if (!(await canConfirmPersonalPurchaseFinance())) return NextResponse.json({ error: "No autorizado." }, { status: 403 });

  const { id } = await params;
  const order = await prisma.personalPurchaseOrder.findUnique({ where: { id } });
  if (!order) return NextResponse.json({ error: "No encontrado." }, { status: 404 });
  if (order.status !== "PENDING_NAIROBY_CLOSE") return NextResponse.json({ error: "Todavía no está confirmada." }, { status: 409 });

  const session = await auth();
  const isAdmin = session!.user.role === "admin";
  const updated = await prisma.personalPurchaseOrder.update({
    where: { id },
    data: { status: "APPROVED", transferClosedAt: new Date(), transferClosedById: isAdmin ? null : session!.user.id },
  });

  await sendPushToOwner(order.employeeId, {
    title: "🎉 Recibimos tu transferencia",
    body: `$${order.totalAmount?.toFixed(2)} — ¡disfrutá tu compra!`,
    url: "/area/compras-personales",
  }).catch(() => null);

  return NextResponse.json(updated);
}
