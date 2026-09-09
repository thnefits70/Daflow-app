import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireAdminSession } from "@/lib/guards";

// Ruta de un solo uso: borra los datos de prueba con el marcador ZZDBG_SUPPDEBT
// (proveedor + producto de prueba del flujo de crédito CHEN, confirmado por
// el usuario 2026-09-09 como "era una prueba", nunca datos reales). Se borra
// esta ruta y la página que la llama en cuanto se confirme que funcionó.
const MARKER = "ZZDBG_SUPPDEBT_1788962455076";

export async function POST() {
  if (!(await requireAdminSession())) return NextResponse.json({ error: "No autorizado." }, { status: 403 });

  const [suppliers, catalogItems] = await Promise.all([
    prisma.supplier.findMany({ where: { name: { contains: MARKER } } }),
    prisma.purchaseCatalogItem.findMany({ where: { name: { contains: MARKER } } }),
  ]);

  const supplierIds = suppliers.map((s) => s.id);
  const catalogItemIds = catalogItems.map((c) => c.id);

  if (supplierIds.length === 0 && catalogItemIds.length === 0) {
    return NextResponse.json({ ok: true, deleted: { purchaseRequests: 0, debtPayments: 0, suppliers: 0, catalogItems: 0 }, note: "No se encontró nada con ese marcador — ya estaba limpio." });
  }

  const result = await prisma.$transaction(async (tx) => {
    const deletedRequests = await tx.purchaseRequest.deleteMany({
      where: { OR: [{ supplierId: { in: supplierIds } }, { carrierId: { in: supplierIds } }, { catalogItemId: { in: catalogItemIds } }] },
    });
    const deletedDebtPayments = await tx.supplierDebtPayment.deleteMany({ where: { supplierId: { in: supplierIds } } });
    const deletedSuppliers = await tx.supplier.deleteMany({ where: { id: { in: supplierIds } } });
    const deletedCatalogItems = await tx.purchaseCatalogItem.deleteMany({ where: { id: { in: catalogItemIds } } });
    return {
      purchaseRequests: deletedRequests.count,
      debtPayments: deletedDebtPayments.count,
      suppliers: deletedSuppliers.count,
      catalogItems: deletedCatalogItems.count,
    };
  });

  return NextResponse.json({ ok: true, deleted: result });
}
