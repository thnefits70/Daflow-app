import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { canConfirmPersonalPurchaseInventory } from "@/lib/guards";

// Confirmado 2026-08-20: independiente del estado de pago — cualquier
// pedido ya confirmado por Daniel (inventoryConfirmedAt) que todavía no
// tiene su salida aprobada (pickedUpAt), sin importar en qué vaya el pago.
export async function GET() {
  if (!(await canConfirmPersonalPurchaseInventory())) return NextResponse.json({ error: "No autorizado." }, { status: 403 });

  const orders = await prisma.personalPurchaseOrder.findMany({
    where: { inventoryConfirmedAt: { not: null }, pickedUpAt: null },
    include: { employee: { select: { name: true } }, items: true },
    orderBy: { inventoryConfirmedAt: "asc" },
  });
  return NextResponse.json(orders);
}
