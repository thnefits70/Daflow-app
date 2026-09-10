import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { auth } from "@/auth";
import { canActOnPurchaseReceiving } from "@/lib/guards";
import { sendPushToOwner } from "@/lib/webPush";
import { notifyOwner } from "@/lib/notifications";
import { getMarketingArrivalActorIds, getMarketingArrivalDispatchViewerIds } from "@/lib/marketingArrivals";
import { recordKardexEntry } from "@/lib/stockKardex";

// Confirmado 2026-08-18: pedido explícito del usuario — la aprobación FINAL
// de Daniel (líder de Inventario) sobre una recepción que ya hizo su equipo
// (ver receipt/route.ts, que deja el pedido en RECEIVED_PENDING_REVIEW). Solo
// acá el pedido pasa a RECEIVED de verdad, se crea PurchaseReceiptFollowUp
// (Marketing) y se notifica a solicitante/marketing — mismo comportamiento
// que antes vivía en receipt/route.ts cuando Daniel era el único que recibía.
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
    include: { catalogItem: { select: { name: true, hasExpiration: true } }, receipt: true },
  });
  if (!existing) return NextResponse.json({ error: "No encontrada." }, { status: 404 });
  if (existing.status !== "RECEIVED_PENDING_REVIEW" || !existing.receipt) {
    return NextResponse.json({ error: "No hay una recepción del equipo pendiente de aprobar." }, { status: 409 });
  }
  if (existing.catalogItem.hasExpiration && !parsedLot?.success) {
    return NextResponse.json({ error: "Este producto tiene caducidad — falta declarar el lote (fecha de vencimiento y cantidad)." }, { status: 409 });
  }

  const isAdmin = session.user.role === "admin";
  const [, updated] = await prisma.$transaction([
    prisma.purchaseRequestReceipt.update({
      where: { requestId: id },
      data: { approvedById: isAdmin ? null : session.user.id, approvedAt: new Date() },
    }),
    prisma.purchaseRequest.update({ where: { id }, data: { status: "RECEIVED" } }),
    // Confirmado 2026-08-08: "Mercadería recibida" — se crea apenas queda
    // RECEIVED de verdad, para que Análisis de Mercado (Robert/Heidy/Jariel)
    // la vea y la vaya confirmando cada quien su parte.
    prisma.purchaseReceiptFollowUp.create({ data: { requestId: id } }),
  ]);

  // Confirmado 2026-09-09 (Fase 3, INVESTOCK): esta aprobación es el mismo
  // candado real de siempre para Compras — acá es donde el Kardex propio
  // suma la entrada. No forma parte de la transacción de arriba (es un
  // read-then-write), pero el riesgo de choque es bajo (equipo chico, no
  // dos aprobaciones simultáneas del mismo producto).
  await recordKardexEntry({
    catalogItemId: existing.catalogItemId,
    type: "IN",
    quantity: existing.receipt.receivedQuantity,
    unitCost: existing.unitCost,
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

  const arrivalBody = `${existing.catalogItem.name} · ${existing.receipt.receivedQuantity} un.${differenceNote}`;
  const [designIds, advisorIds, dispatchIds] = await Promise.all([
    getMarketingArrivalActorIds("design"),
    getMarketingArrivalActorIds("advisor"),
    getMarketingArrivalDispatchViewerIds(),
  ]);
  await Promise.all([
    ...designIds.map((uid) =>
      sendPushToOwner(uid, { title: "Llegó mercadería a bodega", body: arrivalBody, url: "/area/workspace?tab=llegadas" }).catch(() => null)
    ),
    ...advisorIds.map((uid) =>
      sendPushToOwner(uid, { title: "Llegó mercadería a bodega", body: arrivalBody, url: "/area/workspace?tab=llegadas" }).catch(() => null)
    ),
    ...dispatchIds.map((uid) =>
      sendPushToOwner(uid, { title: "Llegó mercadería a bodega", body: `${arrivalBody} — ya puedes ir organizando el despacho.`, url: "/area/workspace?tab=llegadas" }).catch(() => null)
    ),
  ]);

  return NextResponse.json(updated);
}
