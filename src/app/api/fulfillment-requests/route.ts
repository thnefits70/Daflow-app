import { NextResponse } from "next/server";
import { canViewFulfillmentRequests } from "@/lib/guards";
import { prisma } from "@/lib/prisma";
import { ecuadorDay } from "@/lib/fulfillmentGuides";

export async function GET() {
  if (!(await canViewFulfillmentRequests())) {
    return NextResponse.json({ error: "No autorizado." }, { status: 403 });
  }

  const batches = await prisma.fulfillmentRequestBatch.findMany({
    orderBy: { requestedAt: "desc" },
    take: 120,
    include: { requestedBy: { select: { name: true } }, _count: { select: { items: true, guides: true } } },
  });

  return NextResponse.json(
    batches.map((b) => ({
      id: b.id,
      source: b.source,
      requestedAt: b.requestedAt,
      requestedByName: b.requestedBy?.name ?? "Administrador",
      totalRows: b.totalRows,
      skippedCount: b.skippedCount,
      lineCount: b._count.items,
      guideCount: b._count.guides,
      day: ecuadorDay(b.requestedAt),
    }))
  );
}
