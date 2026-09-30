import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { auth } from "@/auth";
import { canConfirmDropiOrderCancelled, dbUserId } from "@/lib/guards";

// Bryan Ríos confirma que la gente de Dropi ya anuló la guía de un producto
// dado de baja (pedido del usuario 2026-09-30). Va por guía (fila), no por
// producto: cada venta es un pedido distinto.
export async function POST(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const session = await auth();
  if (!session || !(await canConfirmDropiOrderCancelled())) return NextResponse.json({ error: "No autorizado." }, { status: 403 });
  const { id } = await params;
  const sale = await prisma.dropiDiscontinuedSale.findUnique({ where: { id }, select: { orderCancelledAt: true } });
  if (!sale) return NextResponse.json({ error: "No encontrado." }, { status: 404 });
  if (sale.orderCancelledAt) return NextResponse.json({ error: "Ya estaba marcada como anulada." }, { status: 409 });
  await prisma.dropiDiscontinuedSale.update({ where: { id }, data: { orderCancelledAt: new Date(), orderCancelledById: dbUserId(session.user.id) } });
  return NextResponse.json({ ok: true });
}
