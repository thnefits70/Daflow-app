import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { canRegisterAdvisorCombo } from "@/lib/comboAlias";

// Buscador de productos para "Registrar combo" de los asesores — mismo
// criterio que los demás catalog-search (traer todo una vez, filtrar en el
// navegador), con su propio guard (ver ProductMatchPicker.tsx).
export async function GET() {
  if (!(await canRegisterAdvisorCombo())) return NextResponse.json({ error: "No autorizado." }, { status: 403 });
  const items = await prisma.purchaseCatalogItem.findMany({
    orderBy: { name: "asc" },
    select: { id: true, name: true, photos: true, justCode: true, pendingRegistration: true },
  });
  return NextResponse.json(items);
}
