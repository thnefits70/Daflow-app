import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { canActOnMerchandiseOutflow } from "@/lib/guards";

const ITEM_INCLUDE = {
  catalogItem: { select: { name: true, photos: true } },
  linkedPurchaseRequest: { select: { requestNumber: true, requestedAt: true, requestedBy: { select: { name: true } } } },
} as const;

// Cola de cambios con proveedor pendientes de saber si el proveedor
// reemplazó el producto o dio crédito — solo de solicitudes ya enviadas
// (batch.submittedAt), mientras Daniel sigue armando la lista de productos
// (ver draft/batches[id]/items) todavía no cuenta como "pendiente".
export async function GET() {
  if (!(await canActOnMerchandiseOutflow())) return NextResponse.json({ error: "No autorizado." }, { status: 403 });
  const items = await prisma.merchandiseOutflowItem.findMany({
    where: { batch: { reason: "CAMBIO_PROVEEDOR", submittedAt: { not: null } }, resolution: null },
    include: { ...ITEM_INCLUDE, batch: { select: { id: true, code: true, createdAt: true, supplier: { select: { id: true, name: true } } } } },
    orderBy: { createdAt: "asc" },
  });
  return NextResponse.json(items);
}
