import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { canActOnMerchandiseOutflow, canManageOutflowPurchaseGestion } from "@/lib/guards";

// Búsqueda liviana de proveedores para Cambio con proveedor — exclusivo de
// Daniel, no reusa /api/purchase-suppliers porque esa ruta la gatea
// canSubmitPurchaseRequests (Bryan/Nairoby/admin), que Daniel no tiene.
// También la usa Jariel al elegir el proveedor de un deterioro escalado
// (PurchaseDeteriorGestionPanel) — antes le devolvía 403 y la lista salía vacía.
export async function GET(req: NextRequest) {
  if (!(await canActOnMerchandiseOutflow()) && !(await canManageOutflowPurchaseGestion())) return NextResponse.json({ error: "No autorizado." }, { status: 403 });

  const q = req.nextUrl.searchParams.get("q")?.trim();
  const suppliers = await prisma.supplier.findMany({
    where: { type: "SUPPLIER", status: "APPROVED", ...(q ? { name: { contains: q, mode: "insensitive" } } : {}) },
    orderBy: { name: "asc" },
    select: { id: true, name: true },
    take: 20,
  });
  return NextResponse.json(suppliers);
}
