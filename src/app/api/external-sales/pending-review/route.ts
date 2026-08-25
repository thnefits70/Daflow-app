import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { canReviewExternalSales } from "@/lib/guards";

export async function GET() {
  if (!(await canReviewExternalSales())) return NextResponse.json({ error: "No autorizado." }, { status: 403 });
  const sales = await prisma.externalSale.findMany({
    where: { reviewStatus: "PENDING" },
    include: { catalogItem: { select: { name: true, photos: true } }, advisor: { select: { name: true } } },
    orderBy: { createdAt: "asc" },
  });
  return NextResponse.json(sales);
}
