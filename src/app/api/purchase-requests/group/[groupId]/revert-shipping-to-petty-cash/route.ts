import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { canManagePettyCashSecundaria } from "@/lib/guards";

// Confirmado 2026-09-04: pedido explícito del usuario — Jariel pidió por
// error que el administrador pague un flete por transferencia (quedó en
// TRANSFER en vez de PETTY_CASH), y no había forma de deshacerlo — quedaba
// atascado en la bandeja de Finanzas. Esto lo regresa a su caja chica
// secundaria: solo quien administra esa caja (hoy Jariel, o admin) puede
// hacerlo, y solo mientras nadie lo haya pagado todavía.
export async function POST(_req: NextRequest, { params }: { params: Promise<{ groupId: string }> }) {
  if (!(await canManagePettyCashSecundaria())) return NextResponse.json({ error: "No autorizado." }, { status: 403 });

  const { groupId } = await params;
  const rows = await prisma.purchaseRequest.findMany({ where: { groupId } });
  if (rows.length === 0) return NextResponse.json({ error: "No encontrada." }, { status: 404 });
  const r0 = rows[0];
  if (r0.shippingIncluded || r0.shippingPaymentTiming !== "ON_DELIVERY") {
    return NextResponse.json({ error: "Esta compra no tiene un flete pendiente." }, { status: 409 });
  }
  if (r0.shippingPaidAt) {
    return NextResponse.json({ error: "El flete ya está pagado — ya no se puede cambiar cómo se pagó." }, { status: 409 });
  }

  await prisma.purchaseRequest.updateMany({
    where: { groupId },
    data: { shippingPaymentMethod: "PETTY_CASH", shippingPaymentRequestedAt: null, shippingPaymentRequestedById: null },
  });

  const updated = await prisma.purchaseRequest.findMany({ where: { groupId } });
  return NextResponse.json(updated);
}
