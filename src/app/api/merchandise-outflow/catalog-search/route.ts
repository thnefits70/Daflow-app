import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { canActOnDeterioro, canCaptureMerchandiseOutflow } from "@/lib/guards";

// Búsqueda de productos para Deterioro y Cambio con proveedor. Antes usaban
// el catalog-search de Reingreso (canCaptureMerchandiseReentry), que desde
// 2026-10-02 solo deja pasar a quien tiene isReentryResponsible (Joel) — al
// resto del equipo de Inventario (incluido Daniel) le devolvía 403 y el
// picker mostraba "No se encontró nada". Mismo guard que agregar renglones
// al lote de deterioro (batches/[id]/items).
export async function GET() {
  if (!(await canCaptureMerchandiseOutflow()) && !(await canActOnDeterioro())) return NextResponse.json({ error: "No autorizado." }, { status: 403 });

  const items = await prisma.purchaseCatalogItem.findMany({
    orderBy: { name: "asc" },
    select: { id: true, name: true, photos: true, justCode: true, pendingRegistration: true },
  });
  return NextResponse.json(items);
}
