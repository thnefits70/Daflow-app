import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { canConfirmPersonalPurchaseFinance } from "@/lib/guards";
import { explainPersonalPurchaseItems } from "@/lib/personalPurchases";

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
      employeeId: true,
      status: true,
      totalAmount: true,
      transferDeadlineAt: true,
      financeConfirmedAt: true,
      employee: { select: { name: true } },
      items: {
        select: {
          id: true,
          createdAt: true,
          employeeProductName: true,
          confirmedProductName: true,
          confirmedCatalogItemId: true,
          quantity: true,
          unitDeclarations: true,
          unitPriceModes: true,
          costUnitPrice: true,
          dropiUnitPrice: true,
          itemTotal: true,
          livePhotoUrl: true,
          optionalPhotoUrl: true,
          confirmedCatalogItem: { select: { justCode: true } },
        },
      },
    },
    orderBy: { createdAt: "asc" },
  });

  // Pedido del usuario 2026-10-03: por qué salió ese precio, en la misma tarjeta.
  const explanations = await explainPersonalPurchaseItems(
    orders.flatMap((o) => o.items.map((it) => ({ ...it, employeeId: o.employeeId, confirmedJustCode: it.confirmedCatalogItem?.justCode ?? null })))
  );
  return NextResponse.json(
    orders.map((o) => ({ ...o, items: o.items.map((it) => ({ ...it, priceExplanation: explanations.get(it.id) ?? null })) }))
  );
}
