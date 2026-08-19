import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { canConfirmPersonalPurchaseInventory } from "@/lib/guards";

export async function GET() {
  if (!(await canConfirmPersonalPurchaseInventory())) return NextResponse.json({ error: "No autorizado." }, { status: 403 });

  const orders = await prisma.personalPurchaseOrder.findMany({
    where: { status: "PENDING_INVENTORY" },
    include: { employee: { select: { name: true } }, items: true },
    orderBy: { createdAt: "asc" },
  });
  return NextResponse.json(orders);
}
