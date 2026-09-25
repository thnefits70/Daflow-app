import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { canActOnPurchaseReceiving } from "@/lib/guards";
import { recordKardexEntry } from "@/lib/stockKardex";
import { effectiveUnitCost } from "@/lib/purchases";
import { auth } from "@/auth";

// Confirmado 2026-09-18: pedido explícito del usuario — el excedente (llegó
// más de lo pedido) entra al Kardex de INVESTOCK como su PROPIA entrada,
// separada de "Confirmar que llegó" (que sigue siendo solo para lo pedido
// bueno). Así lo pedido puede confirmarse ya mismo sin esperar al
// proveedor, y esto queda como un paso aparte que Daniel dispara cuando
// quiera, una vez Bryan ya confirmó el excedente (ver excess-confirm/
// route.ts) — sin importar si la recepción normal ya se cerró antes.
// Exclusiva de Daniel (canActOnPurchaseReceiving), mismo criterio que
// approve-receipt/route.ts, que es el otro punto que corre el Kardex.
export async function POST(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const session = await auth();
  if (!(await canActOnPurchaseReceiving()) || !session) return NextResponse.json({ error: "No autorizado." }, { status: 403 });

  const { id } = await params;
  const existing = await prisma.purchaseRequestUrgentReport.findUnique({
    where: { id },
    include: {
      request: {
        select: {
          catalogItemId: true,
          unitCost: true,
          quantity: true,
          shippingIncluded: true,
          shippingCostTotal: true,
          catalogItem: { select: { name: true, hasExpiration: true } },
        },
      },
    },
  });
  if (!existing) return NextResponse.json({ error: "No encontrado." }, { status: 404 });
  if (existing.excessQty <= 0) return NextResponse.json({ error: "Este reporte no tiene excedente." }, { status: 409 });
  if (!existing.excessConfirmedAt) return NextResponse.json({ error: "Falta que Bryan confirme el excedente primero." }, { status: 409 });
  if (existing.excessKardexRecordedAt) return NextResponse.json({ error: "Ya se ingresó al Kardex." }, { status: 409 });

  const isAdmin = session.user.role === "admin";
  const updated = await prisma.purchaseRequestUrgentReport.update({
    where: { id },
    data: { excessKardexRecordedById: isAdmin ? null : session.user.id, excessKardexRecordedAt: new Date() },
  });

  await recordKardexEntry({
    catalogItemId: existing.request.catalogItemId,
    type: "IN",
    quantity: existing.excessQty,
    unitCost: effectiveUnitCost({
      unitCost: existing.request.unitCost,
      quantity: existing.request.quantity,
      shippingIncluded: existing.request.shippingIncluded,
      shippingCostTotal: existing.request.shippingCostTotal,
    }),
    occurredAt: new Date(),
    // Confirmado 2026-09-25, pedido explícito del usuario: el excedente vino
    // en el mismo lote — usa la caducidad que Inventario declaró en el
    // reporte, sin volver a preguntarla.
    newExpirationLot:
      existing.expirationDeclared && existing.lotExpirationDate
        ? {
            manufactureDate: existing.lotManufactureDate,
            expirationDate: existing.lotExpirationDate,
            quantity: existing.excessQty,
            declaredById: existing.lotDeclaredById,
          }
        : undefined,
  }).catch((err) => console.error("[excess-receive] No se pudo registrar la entrada de Kardex:", err));

  if (existing.expirationDeclared && existing.lotExpirationDate && !existing.request.catalogItem.hasExpiration) {
    await prisma.purchaseCatalogItem.update({ where: { id: existing.request.catalogItemId }, data: { hasExpiration: true } }).catch(() => null);
  }

  return NextResponse.json(updated);
}
