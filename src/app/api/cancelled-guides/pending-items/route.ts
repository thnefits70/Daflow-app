import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { canAssignCancelledGuideItems } from "@/lib/guards";

// Guías que todavía no tienen productos cargados — cola de quien tenga
// canAssignCancelledGuideItems. Corre EN PARALELO con la gestión de Bryan
// (pedido explícito del usuario, 2026-09-02): no espera a que él confirme
// el lote, así que trae también las guías recién subidas por Yair.
// batchManagedAt viaja en la respuesta solo como dato informativo (para
// mostrar si Bryan ya gestionó ese lote o no).
export async function GET() {
  if (!(await canAssignCancelledGuideItems())) return NextResponse.json({ error: "No autorizado." }, { status: 403 });

  const reports = await prisma.cancelledGuideReport.findMany({
    where: { itemsAssignedAt: null, batchCode: { not: null } },
    select: {
      id: true,
      code: true,
      batchCode: true,
      sourceArea: true,
      carrier: true,
      reason: true,
      guideNumber: true,
      createdAt: true,
      submittedBy: { select: { name: true } },
      batchManagedAt: true,
      batchManagedBy: { select: { name: true } },
      fulfillmentRemovedAt: true,
      fulfillmentRemovedBy: { select: { name: true } },
    },
    orderBy: { createdAt: "asc" },
  });
  return NextResponse.json(reports);
}
