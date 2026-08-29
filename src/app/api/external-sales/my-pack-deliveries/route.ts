import { NextResponse } from "next/server";
import { auth } from "@/auth";
import { prisma } from "@/lib/prisma";
import { canPackExternalSale } from "@/lib/guards";

// Igual criterio que my-prep: nunca precios, solo lo necesario para
// embalar y entregar.
export async function GET() {
  const session = await auth();
  if (!(await canPackExternalSale()) || !session) return NextResponse.json({ error: "No autorizado." }, { status: 403 });

  const sales = await prisma.externalSale.findMany({
    where: { packAssignedToId: session.user.id, deliveredAt: null },
    select: {
      id: true,
      code: true,
      declaredProductName: true,
      quantity: true,
      pickupPersonName: true,
      courierNote: true,
      catalogItem: { select: { name: true, photos: true, justCode: true } },
    },
    orderBy: { packAssignedAt: "asc" },
  });
  return NextResponse.json(sales);
}
