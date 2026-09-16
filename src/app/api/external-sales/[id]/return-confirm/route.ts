import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/auth";
import { prisma } from "@/lib/prisma";
import { canActOnMerchandiseOutflow } from "@/lib/guards";
import { notifyEveryoneExternalSaleReturnConfirmed } from "@/lib/externalSales";
import { recordKardexEntry } from "@/lib/stockKardex";

// Confirmado 2026-09-16, pedido explícito del usuario: paso 3, exclusivo de
// Daniel (líder de Inventario) — mismo candado real que ya usa la
// aprobación final de una recepción de Compras. Este clic es el único
// momento en que el stock de la devolución se suma al Kardex (INVESTOCK),
// porque es cuando de verdad quedó confirmado que el producto volvió a
// bodega completo.
export async function POST(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const session = await auth();
  if (!(await canActOnMerchandiseOutflow()) || !session) return NextResponse.json({ error: "No autorizado." }, { status: 403 });

  const { id } = await params;
  const sale = await prisma.externalSale.findUnique({
    where: { id },
    select: {
      returnedAt: true,
      returnReceivedAt: true,
      returnConfirmedAt: true,
      code: true,
      paymentConfirmedAt: true,
      advisorId: true,
      reviewedById: true,
      invoiceUploadedById: true,
      dispatchAssignedToId: true,
      packAssignedToId: true,
      deliveredById: true,
      items: { select: { catalogItemId: true, quantity: true } },
    },
  });
  if (!sale) return NextResponse.json({ error: "No encontrado." }, { status: 404 });
  if (!sale.returnedAt) return NextResponse.json({ error: "Esta venta no fue reportada como devuelta." }, { status: 409 });
  if (!sale.returnReceivedAt) return NextResponse.json({ error: "Todavía no se registró la recepción física." }, { status: 409 });
  if (sale.returnConfirmedAt) return NextResponse.json({ error: "Ya fue aprobada." }, { status: 409 });

  const updated = await prisma.externalSale.update({
    where: { id },
    data: { returnConfirmedAt: new Date(), returnConfirmedById: session.user.id },
  });

  for (const item of sale.items) {
    if (!item.catalogItemId) continue;
    await recordKardexEntry({
      catalogItemId: item.catalogItemId,
      type: "IN",
      quantity: item.quantity,
      unitCost: null,
      occurredAt: new Date(),
    }).catch((err) => console.error("[external-sales return-confirm] No se pudo reingresar el stock al Kardex:", err));
  }

  await notifyEveryoneExternalSaleReturnConfirmed({
    code: sale.code,
    paymentConfirmedAt: sale.paymentConfirmedAt,
    advisorId: sale.advisorId,
    reviewedById: sale.reviewedById,
    invoiceUploadedById: sale.invoiceUploadedById,
    dispatchAssignedToId: sale.dispatchAssignedToId,
    packAssignedToId: sale.packAssignedToId,
    deliveredById: sale.deliveredById,
  });

  return NextResponse.json(updated);
}
