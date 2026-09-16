import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { canCaptureMerchandiseOutflow, canActOnMerchandiseOutflow } from "@/lib/guards";

export async function GET() {
  if (!(await canCaptureMerchandiseOutflow()) && !(await canActOnMerchandiseOutflow())) {
    return NextResponse.json({ error: "No autorizado." }, { status: 403 });
  }
  const sales = await prisma.externalSale.findMany({
    where: { returnedAt: { not: null }, returnConfirmedAt: null, deletedAt: null },
    include: {
      items: { select: { id: true, declaredProductName: true, quantity: true, catalogItem: { select: { name: true, photos: true, justCode: true } } } },
      advisor: { select: { name: true } },
      returnReceivedBy: { select: { name: true } },
    },
    orderBy: { returnedAt: "asc" },
  });
  return NextResponse.json(sales);
}
