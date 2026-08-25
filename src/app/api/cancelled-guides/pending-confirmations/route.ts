import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { canConfirmCancelledGuideFulfillment, canCaptureMerchandiseOutflow } from "@/lib/guards";

// Confirmado 2026-08-25: a diferencia del resto del módulo (donde alguien
// sin liderazgo solo ve lo suyo), acá CUALQUIER miembro de Fulfillment o
// Inventario debe ver TODO lo que le falta confirmar, sin importar quién lo
// subió — son ellos quienes evitan el despacho, no solo quien reportó.
export async function GET() {
  const [canFulfillment, canInventory] = await Promise.all([canConfirmCancelledGuideFulfillment(), canCaptureMerchandiseOutflow()]);
  if (!canFulfillment && !canInventory) return NextResponse.json({ error: "No autorizado." }, { status: 403 });

  const reports = await prisma.cancelledGuideReport.findMany({
    where: {
      OR: [
        ...(canFulfillment ? [{ fulfillmentConfirmedAt: null }] : []),
        ...(canInventory ? [{ inventoryConfirmedAt: null }] : []),
      ],
    },
    include: { submittedBy: { select: { name: true } }, items: { include: { catalogItem: { select: { name: true } } } } },
    orderBy: { createdAt: "asc" },
  });
  return NextResponse.json({ reports, canFulfillment, canInventory });
}
