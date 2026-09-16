import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { auth } from "@/auth";
import { prisma } from "@/lib/prisma";
import { notifyInventoryLeadExternalSaleReturnReported, saleItemsSummary } from "@/lib/externalSales";

const schema = z.object({ reason: z.string().trim().min(3, "Contá brevemente qué pasó.") });

// Confirmado 2026-09-16, pedido explícito del usuario: SOLO el asesor
// dueño de la venta puede reportar que el cliente no recibió el pedido (lo
// rechazó, o lo devolvió) — nadie más, ni Fulfilment ni Inventario. Esto
// todavía NO suma nada a INVESTOCK — solo avisa que esa mercadería debe
// volver físicamente a bodega. El stock recién se reingresa cuando
// Inventario la recibe y Daniel lo aprueba (ver return-received/ y
// return-confirm/). Deja de poder cerrarse (ver /close).
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
      code: true,
      items: { select: { declaredProductName: true, catalogItem: { select: { name: true } } } },
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

  await notifyInventoryLeadExternalSaleReturnReported(sale.code, saleItemsSummary(sale.items));

  return NextResponse.json(updated);
}
