import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { canConfirmPersonalPurchaseFinance } from "@/lib/guards";

export async function GET() {
  if (!(await canConfirmPersonalPurchaseFinance())) return NextResponse.json({ error: "No autorizado." }, { status: 403 });

  const purchases = await prisma.personalPurchase.findMany({
    where: { status: "PENDING_FINANCE" },
    include: { employee: { select: { name: true } }, product: { select: { name: true, photo: true } } },
    orderBy: { createdAt: "asc" },
  });
  return NextResponse.json(purchases);
}
