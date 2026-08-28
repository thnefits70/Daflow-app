import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { canDeclareExternalSales } from "@/lib/guards";

// Ventas Externas reusa el mismo PurchaseCatalogItem sincronizado con Just
// que Reingreso y Compras Personales, pero necesita su propio guard: quien
// declara una venta externa no necesariamente pertenece a Inventario (ej.
// Heidy en Análisis de Mercado), así que no puede usar
// /api/merchandise-reentry/catalog-search (canCaptureMerchandiseReentry).
export async function GET() {
  if (!(await canDeclareExternalSales())) return NextResponse.json({ error: "No autorizado." }, { status: 403 });

  const items = await prisma.purchaseCatalogItem.findMany({
    orderBy: { name: "asc" },
    select: { id: true, name: true, photos: true, justCode: true, pendingRegistration: true },
  });
  return NextResponse.json(items);
}
