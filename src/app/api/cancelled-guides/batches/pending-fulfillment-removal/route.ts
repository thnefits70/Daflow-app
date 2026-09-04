import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { canConfirmCancelledGuideFulfillmentRemoval } from "@/lib/guards";

// Agregado 2026-09-03, pedido explícito del usuario: Yair (líder FUL) ve
// acá los lotes que Bryan ya gestionó con la transportadora/Dropi
// (batchManagedAt) pero todavía no confirmó haber sacado de Fulfillment
// (fulfillmentRemovedAt null) — mismo patrón que /batches (Bryan), el
// cliente arma la agrupación por batchCode.
export async function GET() {
  if (!(await canConfirmCancelledGuideFulfillmentRemoval())) return NextResponse.json({ error: "No autorizado." }, { status: 403 });

  const reports = await prisma.cancelledGuideReport.findMany({
    where: { batchManagedAt: { not: null }, fulfillmentRemovedAt: null, batchCode: { not: null } },
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
    },
    orderBy: { createdAt: "asc" },
  });
  return NextResponse.json(reports);
}
