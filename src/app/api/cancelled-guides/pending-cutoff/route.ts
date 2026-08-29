import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { canManageCancelledGuideCutoff } from "@/lib/guards";

export async function GET() {
  if (!(await canManageCancelledGuideCutoff())) return NextResponse.json({ error: "No autorizado." }, { status: 403 });
  const reports = await prisma.cancelledGuideReport.findMany({
    where: { reallyCancelled: null },
    include: {
      submittedBy: { select: { name: true } },
      items: { include: { catalogItem: { select: { name: true, justCode: true } } } },
      fulfillmentConfirmedBy: { select: { name: true } },
      inventoryConfirmedBy: { select: { name: true } },
    },
    orderBy: { createdAt: "asc" },
  });
  return NextResponse.json(reports);
}
