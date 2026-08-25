import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { canConfirmPurchaseReceiving } from "@/lib/guards";

// Cola de Daniel: reclamos ya aprobados, esperando que él registre la baja
// en Just (DAFLOW no tiene integración con Just — es una confirmación
// humana, ver just-confirm/route.ts).
// Fix confirmado 2026-08-25: guard de VISTA (incluye admin como
// solo-lectura) — confirmar la baja sigue exclusivo de Daniel en
// just-confirm/route.ts.
export async function GET(_req: NextRequest) {
  if (!(await canConfirmPurchaseReceiving())) return NextResponse.json({ error: "No autorizado." }, { status: 403 });

  const claims = await prisma.purchaseRequestUrgentReport.findMany({
    where: { isLateClaim: true, reviewedByLeadAt: { not: null }, rejectedAt: null, justConfirmedAt: null },
    orderBy: { reviewedByLeadAt: "asc" },
    include: {
      request: { select: { catalogItem: { select: { name: true } }, supplier: { select: { name: true } } } },
    },
  });
  return NextResponse.json(claims);
}
