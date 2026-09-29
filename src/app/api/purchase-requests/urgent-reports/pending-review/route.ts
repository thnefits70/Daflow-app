import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { canConfirmPurchaseReceiving } from "@/lib/guards";

// Confirmado 2026-08-18: pedido explícito del usuario — la cola de Daniel
// (líder de Inventario) de "Informar urgente" que su equipo subió y todavía
// no revisó, mismo patrón que urgent-resolutions/pending-replacements.
// Fix confirmado 2026-08-25: usa el guard de VISTA (incluye admin como
// solo-lectura), no el de acción — aprobar sigue siendo exclusivo de Daniel
// en approve/route.ts, que sí usa canActOnPurchaseReceiving.
export async function GET(_req: NextRequest) {
  if (!(await canConfirmPurchaseReceiving())) return NextResponse.json({ error: "No autorizado." }, { status: 403 });

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
          catalogItem: { select: { name: true, photos: true, justCode: true } },
          supplier: { select: { name: true } },
        },
      },
    },
  });
  return NextResponse.json(reports);
}
