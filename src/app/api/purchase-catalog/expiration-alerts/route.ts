import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { canManageJustCatalog } from "@/lib/guards";

// Confirmado 2026-09-23, pedido de Daniel: un lugar donde ver de una vez los
// lotes ya vencidos y los que vencen en 6 meses o menos — antes solo había
// un aviso push (una vez por lote) y un bloque en KPIs financieros que él
// no revisa. Mismo permiso que declarar lotes (Daniel + admin).
export async function GET() {
  if (!(await canManageJustCatalog())) return NextResponse.json({ error: "No autorizado." }, { status: 403 });
  const cutoff = new Date();
  cutoff.setMonth(cutoff.getMonth() + 6);
  const lots = await prisma.expirationCohort.findMany({
    where: { quantityRemaining: { gt: 0 }, expirationDate: { lte: cutoff } },
    orderBy: { expirationDate: "asc" },
    select: {
      id: true,
      expirationDate: true,
      quantityRemaining: true,
      catalogItem: { select: { id: true, name: true, justCode: true } },
    },
  });
  return NextResponse.json(lots);
}
