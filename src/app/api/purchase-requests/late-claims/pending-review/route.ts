import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { canConfirmPurchaseReceiving } from "@/lib/guards";

// Cola de Daniel: reclamos posteriores al cierre que su equipo subió y
// todavía no revisó — mismo patrón que urgent-reports/pending-review.
// Fix confirmado 2026-08-25: guard de VISTA (incluye admin como
// solo-lectura) — aprobar/rechazar sigue exclusivo de Daniel en
// [id]/review/route.ts.
export async function GET(_req: NextRequest) {
  if (!(await canConfirmPurchaseReceiving())) return NextResponse.json({ error: "No autorizado." }, { status: 403 });

  const claims = await prisma.purchaseRequestUrgentReport.findMany({
    where: { isLateClaim: true, reviewedByLeadAt: null, rejectedAt: null },
    orderBy: { reportedAt: "asc" },
    include: {
      reportedBy: { select: { name: true } },
      request: {
        select: {
          quantity: true,
          unitCost: true,
          requestNumber: true,
          catalogItem: { select: { name: true, photos: true, justCode: true } },
          supplier: { select: { name: true } },
        },
      },
    },
  });
  return NextResponse.json(claims);
}
