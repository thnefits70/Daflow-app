import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { canConfirmPersonalPurchaseFinance } from "@/lib/guards";

export async function GET() {
  if (!(await canConfirmPersonalPurchaseFinance())) return NextResponse.json({ error: "No autorizado." }, { status: 403 });

  const orders = await prisma.personalPurchaseOrder.findMany({
    where: { status: "PENDING_NAIROBY_CLOSE" },
    include: {
      employee: { select: { name: true } },
      items: { select: { confirmedProductName: true, employeeProductName: true, quantity: true, confirmedCatalogItem: { select: { justCode: true } } } },
    },
    orderBy: { transferAdminConfirmedAt: "asc" },
  });
  return NextResponse.json(orders);
}
