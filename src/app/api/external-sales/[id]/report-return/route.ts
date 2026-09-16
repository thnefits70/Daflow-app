import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { auth } from "@/auth";
import { prisma } from "@/lib/prisma";
import { notifyEveryoneExternalSaleReturned } from "@/lib/externalSales";
import { recordKardexEntry } from "@/lib/stockKardex";

const schema = z.object({ reason: z.string().trim().min(3, "Contá brevemente qué pasó.") });

// Confirmado 2026-09-16, pedido explícito del usuario: SOLO el asesor
// dueño de la venta puede reportar que el cliente no recibió el pedido (lo
// rechazó, o lo devolvió) — nadie más, ni Fulfilment ni Inventario. El
// producto vuelve intacto (no es un daño), así que el stock se reingresa
// AUTOMÁTICO al Kardex (INVESTOCK) en el momento del reporte, sin pasar
// por la aprobación manual de Reingreso de Mercadería (esa es para
// mercadería dañada). Deja de poder cerrarse (ver /close).
export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const session = await auth();
  if (!session) return NextResponse.json({ error: "No autorizado." }, { status: 403 });

  const { id } = await params;
  const body = await req.json().catch(() => null);
  const parsed = schema.safeParse(body);
  if (!parsed.success) return NextResponse.json({ error: parsed.error.issues[0]?.message ?? "Datos inválidos." }, { status: 400 });

  const sale = await prisma.externalSale.findUnique({
    where: { id },
    select: {
      advisorId: true,
      deliveredAt: true,
      returnedAt: true,
      nairobyClosedAt: true,
      deletedAt: true,
      paymentConfirmedAt: true,
      code: true,
      reviewedById: true,
      invoiceUploadedById: true,
      dispatchAssignedToId: true,
      packAssignedToId: true,
      deliveredById: true,
      items: { select: { catalogItemId: true, quantity: true } },
    },
  });
  if (!sale) return NextResponse.json({ error: "No encontrado." }, { status: 404 });
  if (sale.advisorId !== session.user.id) return NextResponse.json({ error: "No autorizado." }, { status: 403 });
  if (sale.deletedAt) return NextResponse.json({ error: "Esta venta fue cancelada." }, { status: 409 });
  if (!sale.deliveredAt) return NextResponse.json({ error: "Todavía no se registró la entrega al motorizado." }, { status: 409 });
  if (sale.returnedAt) return NextResponse.json({ error: "Ya se reportó esta devolución." }, { status: 409 });
  if (sale.nairobyClosedAt) return NextResponse.json({ error: "Esta venta ya fue cerrada, no se puede reportar como devuelta." }, { status: 409 });

  const updated = await prisma.externalSale.update({
    where: { id },
    data: { returnedAt: new Date(), returnReason: parsed.data.reason },
  });

  for (const item of sale.items) {
    if (!item.catalogItemId) continue;
    await recordKardexEntry({
      catalogItemId: item.catalogItemId,
      type: "IN",
      quantity: item.quantity,
      unitCost: null,
      occurredAt: new Date(),
    }).catch((err) => console.error("[external-sales report-return] No se pudo reingresar el stock al Kardex:", err));
  }

  await notifyEveryoneExternalSaleReturned({
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
