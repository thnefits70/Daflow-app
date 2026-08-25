import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { canViewMerchandiseOutflow } from "@/lib/guards";

const BATCH_INCLUDE = {
  createdBy: { select: { name: true } },
  items: { include: { catalogItem: { select: { name: true, photos: true } }, damageReason: { select: { name: true } } } },
} as const;

// Todo lo que está listo para que Daniel dé de baja en Just, sin importar el
// motivo — un solo lugar en vez de saltar entre despacho/garantía/deterioro/
// compras personales (pedido explícito del usuario). Deterioro solo entra
// acá si el ítem quedó resuelto como WRITE_OFF (solucionado en el momento
// nunca llega a esta cola).
export async function GET() {
  if (!(await canViewMerchandiseOutflow())) return NextResponse.json({ error: "No autorizado." }, { status: 403 });

  const batches = await prisma.merchandiseOutflowBatch.findMany({
    where: {
      justWrittenOffAt: null,
      OR: [
        { reason: { in: ["DESPACHO", "GARANTIA", "COMPRA_PERSONAL"] }, submittedAt: { not: null } },
        { reason: "DETERIORO", items: { some: { resolution: "WRITE_OFF" } } },
      ],
    },
    include: BATCH_INCLUDE,
    orderBy: { submittedAt: "asc" },
  });
  return NextResponse.json(batches);
}
