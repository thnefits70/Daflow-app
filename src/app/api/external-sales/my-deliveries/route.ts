import { NextResponse } from "next/server";
import { auth } from "@/auth";
import { prisma } from "@/lib/prisma";
import { canCaptureMerchandiseOutflow } from "@/lib/guards";

// Confirmado 2026-08-25, pedido explícito del usuario: al colaborador que
// despacha NUNCA le sale información económica — solo nombre del producto,
// foto de referencia, cantidad, y a quién debe entregárselo.
export async function GET() {
  const session = await auth();
  if (!(await canCaptureMerchandiseOutflow()) || !session) return NextResponse.json({ error: "No autorizado." }, { status: 403 });

  const sales = await prisma.externalSale.findMany({
    where: { dispatchAssignedToId: session.user.id, deliveredAt: null },
    select: {
      id: true,
      code: true,
      declaredProductName: true,
      quantity: true,
      pickupPersonName: true,
      courierNote: true,
      catalogItem: { select: { name: true, photos: true } },
    },
    orderBy: { dispatchAssignedAt: "asc" },
  });
  return NextResponse.json(sales);
}
