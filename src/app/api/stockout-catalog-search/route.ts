import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { canManageStockouts } from "@/lib/guards";

// Confirmado 2026-08-29 (pedido explícito del usuario): Ruptura de Stock
// reusa el mismo catálogo sincronizado con Just que Reingreso/Compras/Ventas
// Externas, en vez de escribir el nombre del producto a mano — mismo patrón
// que las demás búsquedas de catálogo, gateado por canManageStockouts.
export async function GET() {
  if (!(await canManageStockouts())) return NextResponse.json({ error: "No autorizado." }, { status: 403 });

  const items = await prisma.purchaseCatalogItem.findMany({
    orderBy: { name: "asc" },
    select: { id: true, name: true, photos: true, justCode: true, pendingRegistration: true },
  });
  return NextResponse.json(items);
}
