import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { canConfirmPersonalPurchaseFinance } from "@/lib/guards";

// Historial de solo lectura: todo lo que ya salió de las colas activas
// (precio cerrado en adelante) — para Nairoby/FIN y admin, mismo guard que
// ya usan para ver la cola de precios.
export async function GET() {
  if (!(await canConfirmPersonalPurchaseFinance())) return NextResponse.json({ error: "No autorizado." }, { status: 403 });

  const orders = await prisma.personalPurchaseOrder.findMany({
    where: { status: { notIn: ["PENDING_INVENTORY", "PENDING_FINANCE"] } },
    include: {
      employee: { select: { name: true } },
      items: {
        select: {
          id: true,
          employeeProductName: true,
          confirmedProductName: true,
          quantity: true,
          costUnitPrice: true,
          dropiUnitPrice: true,
          itemTotal: true,
          confirmedCatalogItem: { select: { justCode: true } },
        },
      },
    },
    orderBy: { createdAt: "desc" },
    take: 200,
  });
  return NextResponse.json(orders);
}
