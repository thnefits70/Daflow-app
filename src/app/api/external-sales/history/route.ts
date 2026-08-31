import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { canViewExternalSales } from "@/lib/guards";

export async function GET() {
  if (!(await canViewExternalSales())) return NextResponse.json({ error: "No autorizado." }, { status: 403 });
  const sales = await prisma.externalSale.findMany({
    include: {
      catalogItem: { select: { name: true, photos: true, justCode: true } },
      advisor: { select: { name: true } },
      client: true,
      reviewedBy: { select: { name: true } },
      paymentConfirmedBy: { select: { name: true } },
      invoiceUploadedBy: { select: { name: true } },
      dispatchAssignedTo: { select: { name: true } },
      prepReadyBy: { select: { name: true } },
      packAssignedTo: { select: { name: true } },
      deliveredBy: { select: { name: true } },
      nairobyClosedBy: { select: { name: true } },
    },
    orderBy: { createdAt: "desc" },
    take: 200,
  });
  return NextResponse.json(sales);
}
