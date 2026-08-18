import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { canConfirmPersonalPurchaseInventory } from "@/lib/guards";

export async function GET() {
  if (!(await canConfirmPersonalPurchaseInventory())) return NextResponse.json({ error: "No autorizado." }, { status: 403 });

  const purchases = await prisma.personalPurchase.findMany({
    where: { status: "PENDING_INVENTORY" },
    include: { employee: { select: { name: true } }, product: { select: { name: true, photo: true } } },
    orderBy: { createdAt: "asc" },
  });
  return NextResponse.json(purchases);
}
