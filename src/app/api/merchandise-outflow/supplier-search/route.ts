import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { canActOnDeterioro, canCaptureMerchandiseOutflow, canManageOutflowPurchaseGestion } from "@/lib/guards";

// Búsqueda liviana de proveedores para Cambio con proveedor — exclusivo de
// Daniel, no reusa /api/purchase-suppliers porque esa ruta la gatea
// canSubmitPurchaseRequests (Bryan/Nairoby/admin), que Daniel no tiene.
// También la usa Jariel al elegir el proveedor de un deterioro escalado
// (PurchaseDeteriorGestionPanel) — antes le devolvía 403 y la lista salía vacía.
// Fix 2026-10-07: el paso "Proveedor" de Deterioro lo usa todo el equipo de
// Inventario (canCaptureMerchandiseOutflow), no solo Daniel — a ellos también
// les salía "No se encontró ningún proveedor".
export async function GET(req: NextRequest) {
  if (!(await canCaptureMerchandiseOutflow()) && !(await canActOnDeterioro()) && !(await canManageOutflowPurchaseGestion())) return NextResponse.json({ error: "No autorizado." }, { status: 403 });

  const q = req.nextUrl.searchParams.get("q")?.trim();
  const suppliers = await prisma.supplier.findMany({
    where: { type: "SUPPLIER", status: "APPROVED", ...(q ? { name: { contains: q, mode: "insensitive" } } : {}) },
    orderBy: { name: "asc" },
    select: { id: true, name: true },
    take: 20,
  });
  return NextResponse.json(suppliers);
}
