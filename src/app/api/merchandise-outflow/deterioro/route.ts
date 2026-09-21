import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { canViewMerchandiseOutflow } from "@/lib/guards";

const ITEM_INCLUDE = {
  batch: { select: { code: true, createdAt: true, createdBy: { select: { name: true } }, supplier: { select: { id: true, name: true } }, documentPhotoUrls: true } },
  catalogItem: { select: { name: true, photos: true, justCode: true } },
  damageReason: { select: { name: true } },
} as const;

// Cola de deterioro pendiente de resolución de Daniel (resolution null) —
// visible a todo el equipo de Inventario para seguimiento, aunque solo
// Daniel puede resolver (ver items/[id]/resolve).
// Confirmado 2026-09-21: la captura de un reporte nuevo ya no vive acá (ver
// /api/merchandise-outflow/draft + batches/[id]/items + batches/[id]/submit,
// mismo patrón "carrito" que CAMBIO_PROVEEDOR) — pedido explícito de Daniel
// para poder elegir proveedor de una vez y meter varios productos en un
// mismo reporte con una sola foto, en vez de uno por uno.
export async function GET() {
  if (!(await canViewMerchandiseOutflow())) return NextResponse.json({ error: "No autorizado." }, { status: 403 });
  const items = await prisma.merchandiseOutflowItem.findMany({
    where: { batch: { reason: "DETERIORO" }, resolution: null },
    include: ITEM_INCLUDE,
    orderBy: { createdAt: "asc" },
  });
  return NextResponse.json(items);
}
