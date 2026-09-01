import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { canViewComboSuggestions, canUploadLowRotationList } from "@/lib/guards";

// Mismo patrón que merchandise-reentry/catalog-search: trae el catálogo
// completo una sola vez, el filtrado por palabras es del lado del cliente
// (ver ProductMatchPicker). Usado tanto para enlazar manualmente una fila de
// ATOM no reconocida como para la lista semanal de baja rotación de Daniel.
export async function GET() {
  if (!(await canViewComboSuggestions()) && !(await canUploadLowRotationList())) {
    return NextResponse.json({ error: "No autorizado." }, { status: 403 });
  }

  const items = await prisma.purchaseCatalogItem.findMany({
    orderBy: { name: "asc" },
    select: { id: true, name: true, photos: true, justCode: true, pendingRegistration: true },
  });
  return NextResponse.json(items);
}
