import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { canConfirmPurchaseReceiving } from "@/lib/guards";

// Confirmado 2026-09-18: pedido explícito del usuario — cola de Daniel de
// excedentes ya confirmados por Bryan (ver excess-confirm/route.ts) y que
// todavía no se ingresaron al Kardex (ver excess-receive/route.ts). Mismo
// patrón que urgent-reports/pending-review — guard de VISTA (incluye admin
// solo lectura), la acción real exige canActOnPurchaseReceiving aparte.
export async function GET(_req: NextRequest) {
  if (!(await canConfirmPurchaseReceiving())) return NextResponse.json({ error: "No autorizado." }, { status: 403 });

  const reports = await prisma.purchaseRequestUrgentReport.findMany({
    where: { excessQty: { gt: 0 }, excessConfirmedAt: { not: null }, excessKardexRecordedAt: null },
    orderBy: { excessConfirmedAt: "asc" },
    include: {
      excessGestionBy: { select: { name: true } },
      excessConfirmedBy: { select: { name: true } },
      request: {
        select: {
          quantity: true,
          catalogItem: { select: { name: true, justCode: true } },
          supplier: { select: { name: true } },
        },
      },
    },
  });
  return NextResponse.json(reports);
}
