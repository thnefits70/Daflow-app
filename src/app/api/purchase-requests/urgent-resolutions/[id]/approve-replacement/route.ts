import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/auth";
import { prisma } from "@/lib/prisma";
import { canActOnPurchaseReceiving } from "@/lib/guards";
import { recordKardexEntry } from "@/lib/stockKardex";
import { effectiveUnitCost } from "@/lib/purchases";
import { notifyReceiptRegistered } from "@/lib/purchaseReceiptFromReport";
import { notifyOwner } from "@/lib/notifications";

// Confirmado 2026-08-18: pedido explícito del usuario — aprobación final de
// Daniel sobre un cambio de mercadería que ya subió su equipo (ver
// replacement-arrived/route.ts). Recién acá el status pasa a COMPLETED —
// mismo patrón que approve-receipt para la recepción normal.
// Confirmado 2026-09-23: bug real — el reemplazo nunca entraba a
// INVESTOCK (antes Daniel lo subía a Just a mano desde su pestaña "Just",
// que ya no existe). Ahora, al aprobarlo, las unidades buenas que mandó el
// proveedor entran solas al Kardex con el costo real de la compra original
// (el proveedor no cobra el reemplazo — ya se pagó en esa compra).
export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const session = await auth();
  if (!(await canActOnPurchaseReceiving()) || !session) return NextResponse.json({ error: "No autorizado." }, { status: 403 });

  const { id } = await params;
  const resolution = await prisma.purchaseUrgentResolution.findUnique({
    where: { id },
    include: {
      report: {
        select: {
          request: {
            select: {
              id: true,
              requestedById: true,
              catalogItemId: true,
              unitCost: true,
              quantity: true,
              shippingIncluded: true,
              shippingCostTotal: true,
              catalogItem: { select: { name: true } },
              receipt: { select: { id: true } },
            },
          },
        },
      },
    },
  });
  if (!resolution || resolution.type !== "REPLACEMENT") return NextResponse.json({ error: "No encontrada." }, { status: 404 });
  if (resolution.status !== "PENDING" || !resolution.replacementSubmittedAt) {
    return NextResponse.json({ error: "Todavía no hay una recepción del equipo pendiente de aprobar." }, { status: 409 });
  }

  const isAdmin = session.user.role === "admin";
  const updated = await prisma.purchaseUrgentResolution.update({
    where: { id, status: "PENDING" },
    data: {
      status: "COMPLETED",
      replacementArrivedAt: new Date(),
      replacementVerifiedById: isAdmin ? null : session.user.id,
    },
  });

  const request = resolution.report.request;
  const qty = resolution.replacementReceivedQty ?? resolution.quantity;

  // Pedido del usuario 2026-10-15 (caso #177, 240 Máquinas de Coser Manual,
  // Jolly Mia): cuando el producto ENTERO no llegó con el resto del pedido,
  // Inventario lo reporta como faltante y lo que llega después entra por acá
  // ("entrega recibida"). Antes solo sumaba al Kardex: la compra se quedaba
  // en PAID sin recepción, no aparecía en ningún historial y Análisis de
  // Mercado (Jariel) nunca recibía "Llegó mercadería". Ahora esa llegada
  // queda como la recepción real de la compra — igual que una normal ya
  // aprobada por Daniel — y avisa a los mismos de siempre.
  let receiptId: string | undefined;
  if (resolution.replacementIsMissingDelivery && !request.receipt && qty > 0) {
    const [receipt] = await prisma.$transaction([
      prisma.purchaseRequestReceipt.create({
        data: {
          requestId: request.id,
          receivedQuantity: qty,
          photoUrls: resolution.replacementPhotoUrls,
          comment: `Llegó después, como entrega del faltante (reporte urgente) — se esperaban ${resolution.quantity} un.`,
          aiPhotoMatch: resolution.replacementAiMatch,
          aiPhotoNote: resolution.replacementAiNote,
          confirmedById: resolution.replacementSubmittedById,
          confirmedAt: resolution.replacementSubmittedAt,
          approvedById: isAdmin ? null : session.user.id,
          approvedAt: new Date(),
        },
      }),
      prisma.purchaseRequest.update({ where: { id: request.id }, data: { status: "RECEIVED" } }),
      prisma.purchaseReceiptFollowUp.upsert({ where: { requestId: request.id }, create: { requestId: request.id }, update: {} }),
    ]);
    receiptId = receipt.id;
  }

  if (qty > 0) {
    await recordKardexEntry({
      catalogItemId: request.catalogItemId,
      type: "IN",
      quantity: qty,
      unitCost: effectiveUnitCost(request),
      occurredAt: new Date(),
      purchaseRequestReceiptId: receiptId,
    }).catch((err) => console.error("[approve-replacement] No se pudo registrar la entrada de Kardex:", err));
  }

  if (receiptId) {
    await notifyReceiptRegistered({ catalogItemId: request.catalogItemId, itemName: request.catalogItem.name, quantity: qty, skipLeadNotice: true }).catch((err) =>
      console.error("[approve-replacement] avisos:", err)
    );
    if (request.requestedById) {
      await notifyOwner(request.requestedById, {
        title: "Mercadería recibida",
        body: `${request.catalogItem.name} — llegó la entrega pendiente: ${qty} un.${qty !== resolution.quantity ? ` (se esperaban ${resolution.quantity})` : ""}.`,
        url: "/area/workspace",
      }).catch(() => null);
    }
  }

  return NextResponse.json(updated);
}
