import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { canConfirmExternalSalePayment } from "@/lib/guards";

export async function GET() {
  if (!(await canConfirmExternalSalePayment())) return NextResponse.json({ error: "No autorizado." }, { status: 403 });
  const sales = await prisma.externalSale.findMany({
    where: { reviewStatus: "APPROVED", paymentProofUrl: { not: null }, paymentConfirmedAt: null },
    include: { catalogItem: { select: { name: true, justCode: true } }, advisor: { select: { name: true } } },
    orderBy: { paymentProofUploadedAt: "asc" },
  });
  return NextResponse.json(sales);
}
