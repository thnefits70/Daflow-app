import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { canReportSupplierStockout } from "@/lib/guards";

// Confirmado 2026-09-23: mismo patrón que merchandise-reentry/catalog-search
// — trae el catálogo completo una sola vez para filtrar por palabras clave
// del lado del cliente (ver ProductMatchPicker). Gateado a quien puede
// reportar sin stock de proveedor (hoy Jariel), no al guard de Inventario.
export async function GET() {
  if (!(await canReportSupplierStockout())) return NextResponse.json({ error: "No autorizado." }, { status: 403 });

  const items = await prisma.purchaseCatalogItem.findMany({
    orderBy: { name: "asc" },
    select: { id: true, name: true, photos: true, justCode: true, pendingRegistration: true },
  });
  return NextResponse.json(items);
}
