import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { canConfirmPersonalPurchaseFinance } from "@/lib/guards";

export async function GET() {
  if (!(await canConfirmPersonalPurchaseFinance())) return NextResponse.json({ error: "No autorizado." }, { status: 403 });

  const orders = await prisma.personalPurchaseOrder.findMany({
    where: { status: "PENDING_FINANCE" },
    include: {
      employee: { select: { name: true } },
      items: { select: { id: true, confirmedProductName: true, employeeProductName: true, quantity: true, unitPriceModes: true, livePhotoUrl: true, optionalPhotoUrl: true, costUnitPrice: true, dropiUnitPrice: true, confirmedCatalogItem: { select: { justCode: true } } } },
    },
    orderBy: { createdAt: "asc" },
  });
  return NextResponse.json(orders);
}
