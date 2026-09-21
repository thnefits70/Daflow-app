import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireAdminSession } from "@/lib/guards";

// Confirmado 2026-09-21, pedido explícito del usuario: pedidos que Daniel ya
// confirmó en bodega pero el precio automático no se pudo calcular porque
// algún producto todavía no tiene costo en ninguna de las 3 fuentes
// (propuesta de Jariel/Kardex INVESTOCK/respaldo de Just) — ver
// resolveAutoUnitPricing en personalPurchases.ts. Nadie puede escribir un
// precio a mano para esto (pedido explícito del usuario, 2026-09-21); solo
// admin ve esta cola, para reintentar apenas el producto tenga costo.
export async function GET() {
  if (!(await requireAdminSession())) return NextResponse.json({ error: "No autorizado." }, { status: 403 });

  const orders = await prisma.personalPurchaseOrder.findMany({
    where: { status: "PENDING_FINANCE", priceReopenedAt: null },
    select: {
      id: true,
      inventoryConfirmedAt: true,
      employee: { select: { name: true } },
      items: { select: { confirmedProductName: true, employeeProductName: true, quantity: true, confirmedCatalogItem: { select: { justCode: true } } } },
    },
    orderBy: { inventoryConfirmedAt: "asc" },
  });
  return NextResponse.json(orders);
}
