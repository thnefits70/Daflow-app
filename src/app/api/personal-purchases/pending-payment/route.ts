import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { canConfirmPersonalPurchaseFinance } from "@/lib/guards";

// Solo lectura: compras con precio ya cerrado donde el colaborador todavía
// no resuelve el pago (PENDING_PAYMENT_METHOD / PENDING_TRANSFER_PROOF).
// Mismo filtro de estados que getPersonalPurchasePaymentWatchItem en
// pendingTasks.ts — es el contenido al que debe llevar esa notificación.
export async function GET() {
  if (!(await canConfirmPersonalPurchaseFinance())) return NextResponse.json({ error: "No autorizado." }, { status: 403 });

  const orders = await prisma.personalPurchaseOrder.findMany({
    where: { status: { in: ["PENDING_PAYMENT_METHOD", "PENDING_TRANSFER_PROOF"] } },
    select: {
      id: true,
      status: true,
      totalAmount: true,
      transferDeadlineAt: true,
      financeConfirmedAt: true,
      employee: { select: { name: true } },
    },
    orderBy: { createdAt: "asc" },
  });
  return NextResponse.json(orders);
}
