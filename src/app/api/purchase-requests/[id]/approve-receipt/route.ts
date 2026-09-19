import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { auth } from "@/auth";
import { canActOnPurchaseReceiving } from "@/lib/guards";
import { notifyOwner } from "@/lib/notifications";
import { recordKardexEntry } from "@/lib/stockKardex";
import { effectiveUnitCost } from "@/lib/purchases";

// Confirmado 2026-08-18: pedido explícito del usuario — la aprobación FINAL
// de Daniel (líder de Inventario) sobre una recepción que ya hizo su equipo
// (ver receipt/route.ts, que deja el pedido en RECEIVED_PENDING_REVIEW). Acá
// el pedido pasa a RECEIVED de verdad y se notifica al solicitante.
// Confirmado 2026-09-16, pedido explícito del usuario: el aviso a Análisis de
// Mercado/despacho y la creación de PurchaseReceiptFollowUp ya NO ocurren
// acá — se movieron a receipt/route.ts para que Robert/Heidy/Jariel/Yair se
// enteren y puedan confirmar su parte apenas bodega registra la recepción,
// sin esperar esta aprobación de Daniel (que ahora solo importa para
// Compras: costo real, Kardex, cierre del ciclo de compra).
// Confirmado 2026-09-10 (lotes de caducidad, pedido de Daniel): si el
// producto ya está marcado con caducidad, esta aprobación exige la fecha de
// vencimiento (fabricación es opcional) — es el mismo candado de siempre
// para Compras, ahora también el punto donde se declara el lote.
const expirationLotSchema = z.object({
  manufactureDate: z.string().trim().min(1).nullable().optional(),
  expirationDate: z.string().trim().min(1),
  quantity: z.number().int().positive(),
});

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const session = await auth();
  if (!(await canActOnPurchaseReceiving()) || !session) return NextResponse.json({ error: "No autorizado." }, { status: 403 });

  const { id } = await params;
  const body = await req.json().catch(() => null);
  const parsedLot = body?.expirationLot ? expirationLotSchema.safeParse(body.expirationLot) : null;
  if (body?.expirationLot && !parsedLot?.success) {
    return NextResponse.json({ error: parsedLot?.error.issues[0]?.message ?? "Datos de caducidad inválidos." }, { status: 400 });
  }

  const existing = await prisma.purchaseRequest.findUnique({
    where: { id },
    include: { catalogItem: { select: { name: true, hasExpiration: true, awaitingDropiId: true } }, receipt: true },
  });
  if (!existing) return NextResponse.json({ error: "No encontrada." }, { status: 404 });
  if (existing.status !== "RECEIVED_PENDING_REVIEW" || !existing.receipt) {
    return NextResponse.json({ error: "No hay una recepción del equipo pendiente de aprobar." }, { status: 409 });
  }
  if (existing.catalogItem.hasExpiration && !parsedLot?.success) {
    return NextResponse.json({ error: "Este producto tiene caducidad — falta declarar el lote (fecha de vencimiento y cantidad)." }, { status: 409 });
  }
  // Confirmado 2026-09-18: un producto nuevo pendiente de ID Dropi todavía no
  // suma al Kardex (ver más abajo) — declarar su lote de caducidad se pide
  // después, una vez liberado, desde "Lotes de Caducidad" (declareExpirationLot),
  // para no perder ese dato mientras se espera el ID.
  if (existing.catalogItem.awaitingDropiId && parsedLot?.success) {
    return NextResponse.json(
      { error: "Este producto está pendiente de ID de Dropi — declara el lote de caducidad después de que se libere al Kardex." },
      { status: 409 }
    );
  }

  const isAdmin = session.user.role === "admin";
  const [, updated] = await prisma.$transaction([
    prisma.purchaseRequestReceipt.update({
      where: { requestId: id },
      data: { approvedById: isAdmin ? null : session.user.id, approvedAt: new Date() },
    }),
    prisma.purchaseRequest.update({ where: { id }, data: { status: "RECEIVED" } }),
  ]);

  if (existing.catalogItem.awaitingDropiId) {
    // Confirmado 2026-09-18, pedido explícito del usuario: un producto nuevo
    // propuesto en Análisis de Mercado puede comprarse y recibirse sin
    // esperar el ID de Dropi — pero NO entra al Kardex de INVESTOCK todavía.
    // Queda RECEIVED con receipt.stockKardexEntry en null hasta que Heidy
    // confirme el ID y Bryan libere (ver release-kardex/route.ts, que
    // recorre estas recepciones pendientes y las suma en orden real).
    const publishers = await prisma.user.findMany({ where: { canPublishMarketProduct: true }, select: { id: true } });
    await Promise.all(
      publishers.map((u) =>
        notifyOwner(u.id, {
          title: "Compra recibida — falta tu ID de Dropi",
          body: `${existing.catalogItem.name} ya llegó a bodega. Súbelo a Dropi para que Bryan pueda liberarlo al Kardex.`,
          url: "/area/workspace?tab=analisis-mercado",
        }).catch(() => null)
      )
    );
  } else {
    // Confirmado 2026-09-09 (Fase 3, INVESTOCK): esta aprobación es el mismo
    // candado real de siempre para Compras — acá es donde el Kardex propio
    // suma la entrada. No forma parte de la transacción de arriba (es un
    // read-then-write), pero el riesgo de choque es bajo (equipo chico, no
    // dos aprobaciones simultáneas del mismo producto).
    // Confirmado 2026-09-16, pedido explícito del usuario: el Kardex sumaba
    // solo el precio del proveedor, sin el flete — mismo `effectiveUnitCost()`
    // que ya usa la comparación de precios de Bryan (PurchaseApprovalInbox),
    // ahora también acá, para que "Costo Prom." represente el costo real
    // puesto en bodega. Usa `existing.quantity` (la cantidad de la solicitud,
    // sobre la que se cotizó el flete total) para el flete por unidad — no
    // `receipt.receivedQuantity` (la cantidad real recibida), que es la que
    // de verdad entra al saldo de stock más abajo.
    await recordKardexEntry({
      catalogItemId: existing.catalogItemId,
      type: "IN",
      quantity: existing.receipt.receivedQuantity,
      unitCost: effectiveUnitCost({
        unitCost: existing.unitCost,
        quantity: existing.quantity,
        shippingIncluded: existing.shippingIncluded,
        shippingCostTotal: existing.shippingCostTotal,
      }),
      occurredAt: new Date(),
      purchaseRequestReceiptId: existing.receipt.id,
      newExpirationLot: parsedLot?.success
        ? {
            manufactureDate: parsedLot.data.manufactureDate ? new Date(parsedLot.data.manufactureDate) : null,
            expirationDate: new Date(parsedLot.data.expirationDate),
            quantity: parsedLot.data.quantity,
            declaredById: isAdmin ? null : session.user.id,
          }
        : undefined,
    }).catch((err) => console.error("[approve-receipt] No se pudo registrar la entrada de Kardex:", err));

    // Confirmado 2026-09-10 (lotes de caducidad): si el producto no estaba
    // marcado todavía y sí se declaró lote, queda marcado para siempre —
    // la próxima compra de este producto ya pide las fechas directo, sin
    // volver a preguntar "¿tiene o no tiene?".
    if (parsedLot?.success && !existing.catalogItem.hasExpiration) {
      await prisma.purchaseCatalogItem.update({ where: { id: existing.catalogItemId }, data: { hasExpiration: true } }).catch((err) =>
        console.error("[approve-receipt] No se pudo marcar hasExpiration:", err)
      );
    }
  }

  const differenceNote = existing.receipt.minorDifferenceConfirmed
    ? ` ⚠️ Llegó con una diferencia menor frente a la referencia (confirmado por Inventario)${existing.receipt.aiPhotoNote ? `: ${existing.receipt.aiPhotoNote}` : ""}.`
    : "";

  if (existing.requestedById) {
    await notifyOwner(existing.requestedById, {
      title: "Mercadería recibida",
      body: `${existing.catalogItem.name} — Inventario confirmó ${existing.receipt.receivedQuantity} un. recibidas.${differenceNote}`,
      url: "/area/workspace",
    }).catch(() => null);
  }

  return NextResponse.json(updated);
}
