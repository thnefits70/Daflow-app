import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { canAssignCancelledGuideItems } from "@/lib/guards";

// Guías que Bryan ya gestionó con la transportadora/Dropi y todavía no
// tienen productos cargados — cola de quien tenga canAssignCancelledGuideItems.
export async function GET() {
  if (!(await canAssignCancelledGuideItems())) return NextResponse.json({ error: "No autorizado." }, { status: 403 });

  const reports = await prisma.cancelledGuideReport.findMany({
    where: { batchManagedAt: { not: null }, itemsAssignedAt: null },
    select: { id: true, code: true, batchCode: true, sourceArea: true, carrier: true, reason: true, guideNumber: true, batchManagedAt: true },
    orderBy: { batchManagedAt: "asc" },
  });
  return NextResponse.json(reports);
}
