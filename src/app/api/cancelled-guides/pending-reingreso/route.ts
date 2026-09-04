import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { canActOnMerchandiseOutflow } from "@/lib/guards";

export async function GET() {
  if (!(await canActOnMerchandiseOutflow())) return NextResponse.json({ error: "No autorizado." }, { status: 403 });
  // Bryan (batchManagedAt), Yair (fulfillmentRemovedAt) y Heidy
  // (itemsAssignedAt) trabajan en paralelo — acá se exigen los TRES, sin
  // importar cuál terminó primero. Se incluye quién hizo cada paso y
  // cuándo (pedido explícito del usuario 2026-09-03) para que Daniel vea
  // quién aprobó/confirmó antes de reingresar.
  const reports = await prisma.cancelledGuideReport.findMany({
    where: { batchManagedAt: { not: null }, fulfillmentRemovedAt: { not: null }, itemsAssignedAt: { not: null }, reingresadoAt: null },
    include: {
      items: { include: { catalogItem: { select: { name: true, justCode: true } } } },
      batchManagedBy: { select: { name: true } },
      fulfillmentRemovedBy: { select: { name: true } },
    },
    orderBy: { itemsAssignedAt: "asc" },
  });
  return NextResponse.json(reports);
}
