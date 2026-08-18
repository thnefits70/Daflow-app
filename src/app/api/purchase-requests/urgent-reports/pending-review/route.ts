import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { canActOnPurchaseReceiving } from "@/lib/guards";

// Confirmado 2026-08-18: pedido explícito del usuario — la cola de Daniel
// (líder de Inventario) de "Informar urgente" que su equipo subió y todavía
// no revisó, mismo patrón que urgent-resolutions/pending-replacements.
export async function GET(_req: NextRequest) {
  if (!(await canActOnPurchaseReceiving())) return NextResponse.json({ error: "No autorizado." }, { status: 403 });

  const reports = await prisma.purchaseRequestUrgentReport.findMany({
    where: { reviewedByLeadAt: null },
    orderBy: { reportedAt: "asc" },
    include: {
      reportedBy: { select: { name: true } },
      request: {
        select: {
          quantity: true,
          unitCost: true,
          totalCost: true,
          catalogItem: { select: { name: true, photos: true } },
          supplier: { select: { name: true } },
        },
      },
    },
  });
  return NextResponse.json(reports);
}
