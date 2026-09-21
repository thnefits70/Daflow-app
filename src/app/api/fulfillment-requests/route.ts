import { NextResponse } from "next/server";
import { canViewFulfillmentRequests } from "@/lib/guards";
import { prisma } from "@/lib/prisma";

export async function GET() {
  if (!(await canViewFulfillmentRequests())) {
    return NextResponse.json({ error: "No autorizado." }, { status: 403 });
  }

  const batches = await prisma.fulfillmentRequestBatch.findMany({
    orderBy: { requestedAt: "desc" },
    take: 30,
    include: { requestedBy: { select: { name: true } }, _count: { select: { items: true } } },
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
    }))
  );
}
