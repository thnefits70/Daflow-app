import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { canCloseExternalSale } from "@/lib/guards";

export async function GET() {
  if (!(await canCloseExternalSale())) return NextResponse.json({ error: "No autorizado." }, { status: 403 });
  const sales = await prisma.externalSale.findMany({
    where: { paymentConfirmedAt: { not: null }, deliveredAt: { not: null }, nairobyClosedAt: null, deletedAt: null },
    include: {
      items: { include: { catalogItem: { select: { name: true, photos: true, justCode: true } } }, orderBy: { createdAt: "asc" } },
      advisor: { select: { name: true } },
      dispatchAssignedTo: { select: { name: true } },
      packAssignedTo: { select: { name: true } },
      deliveredBy: { select: { name: true } },
      invoiceUploadedBy: { select: { name: true } },
    },
    orderBy: { createdAt: "asc" },
  });
  return NextResponse.json(sales);
}
