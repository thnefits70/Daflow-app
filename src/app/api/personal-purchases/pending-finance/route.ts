import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { canConfirmPersonalPurchaseFinance } from "@/lib/guards";

// Confirmado 2026-09-21, pedido explícito del usuario: el precio ahora se
// calcula solo apenas Daniel confirma bodega (ver resolveAutoUnitPricing en
// personalPurchases.ts) — esta cola ya NO es el paso normal, solo aparecen
// acá los pedidos que Nairoby reabrió ella misma para corregir un precio
// (priceReopenedAt no nulo). Un pedido que se quedó esperando porque le
// faltó costo en INVESTOCK NO debe aparecer acá — no hay ningún precio que
// ella pueda inventar a mano para ese caso (ver
// getPersonalPurchaseAwaitingCostPendingItem en pendingTasks.ts).
export async function GET() {
  if (!(await canConfirmPersonalPurchaseFinance())) return NextResponse.json({ error: "No autorizado." }, { status: 403 });

  const orders = await prisma.personalPurchaseOrder.findMany({
    where: { status: "PENDING_FINANCE", priceReopenedAt: { not: null } },
    include: {
      employee: { select: { name: true } },
      items: { select: { id: true, confirmedProductName: true, employeeProductName: true, quantity: true, unitPriceModes: true, livePhotoUrl: true, optionalPhotoUrl: true, costUnitPrice: true, dropiUnitPrice: true, confirmedCatalogItem: { select: { justCode: true } } } },
    },
    orderBy: { createdAt: "asc" },
  });
  return NextResponse.json(orders);
}
