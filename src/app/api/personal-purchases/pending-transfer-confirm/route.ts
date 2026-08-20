import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { canConfirmPersonalPurchaseTransfer } from "@/lib/guards";

export async function GET() {
  if (!(await canConfirmPersonalPurchaseTransfer())) return NextResponse.json({ error: "No autorizado." }, { status: 403 });

  const orders = await prisma.personalPurchaseOrder.findMany({
    where: { status: "PENDING_ADMIN_CONFIRM" },
    include: { employee: { select: { name: true } } },
    orderBy: { transferProofUploadedAt: "asc" },
  });
  return NextResponse.json(orders);
}
