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
    // prepReadyAt: desde 2026-10-05 se puede asignar quién embala antes de
    // agrupar — recién aparece acá cuando ya está agrupada.
    where: { packAssignedToId: session.user.id, prepReadyAt: { not: null }, deliveredAt: null, deletedAt: null },
    select: {
      id: true,
      code: true,
      pickupPersonName: true,
      courierNote: true,
      // Garantías: solo lo que sale de bodega (lo que se recoge no está acá).
      items: {
        where: { OR: [{ warrantyRole: null }, { warrantyRole: "DELIVER" as const }] }, 
        select: { id: true, declaredProductName: true, quantity: true, sellerReferencePhotoUrl: true, catalogItem: { select: { name: true, photos: true, justCode: true } } },
        orderBy: { createdAt: "asc" },
      },
    },
    orderBy: { packAssignedAt: "asc" },
  });
  return NextResponse.json(sales);
}
