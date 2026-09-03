import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { canAssignCancelledGuideItems } from "@/lib/guards";

// Mismo patrón que /api/merchandise-reentry/catalog-search (ver comentario
// en ProductMatchPicker.tsx: cada consumidor del picker apunta a su propio
// endpoint de búsqueda porque el guard de autorización varía). Quien carga
// productos de una guía cancelada (Heidy, vía canAssignCancelledGuideItems)
// no tiene por qué tener canCaptureMerchandiseReentry (equipo de
// Inventario) — antes el picker apuntaba al endpoint de Inventario y el
// fetch le devolvía 403, así que nunca veía sugerencias al buscar.
export async function GET() {
  if (!(await canAssignCancelledGuideItems())) return NextResponse.json({ error: "No autorizado." }, { status: 403 });

  const items = await prisma.purchaseCatalogItem.findMany({
    orderBy: { name: "asc" },
    select: { id: true, name: true, photos: true, justCode: true, pendingRegistration: true },
  });
  return NextResponse.json(items);
}
