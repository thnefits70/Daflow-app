import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { canSubmitFulfillmentRequest } from "@/lib/guards";

// Mismo criterio que catalog-search de Reingreso (traer todo una vez,
// filtrar en el navegador) pero con su propio guard — ver comentario en
// ProductMatchPicker.tsx sobre por qué cada consumidor tiene su propio
// endpoint de búsqueda.
export async function GET() {
  if (!(await canSubmitFulfillmentRequest())) return NextResponse.json({ error: "No autorizado." }, { status: 403 });

  const items = await prisma.purchaseCatalogItem.findMany({
    orderBy: { name: "asc" },
    select: { id: true, name: true, photos: true, justCode: true, pendingRegistration: true },
  });
  return NextResponse.json(items);
}
