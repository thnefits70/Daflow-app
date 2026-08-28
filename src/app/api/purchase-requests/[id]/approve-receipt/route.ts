import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { auth } from "@/auth";
import { canActOnPurchaseReceiving } from "@/lib/guards";
import { sendPushToOwner } from "@/lib/webPush";
import { notifyOwner } from "@/lib/notifications";
import { getMarketingArrivalActorIds, getMarketingArrivalDispatchViewerIds } from "@/lib/marketingArrivals";

// Confirmado 2026-08-18: pedido explícito del usuario — la aprobación FINAL
// de Daniel (líder de Inventario) sobre una recepción que ya hizo su equipo
// (ver receipt/route.ts, que deja el pedido en RECEIVED_PENDING_REVIEW). Solo
// acá el pedido pasa a RECEIVED de verdad, se crea PurchaseReceiptFollowUp
// (Marketing) y se notifica a solicitante/marketing — mismo comportamiento
// que antes vivía en receipt/route.ts cuando Daniel era el único que recibía.
export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const session = await auth();
  if (!(await canActOnPurchaseReceiving()) || !session) return NextResponse.json({ error: "No autorizado." }, { status: 403 });

  const { id } = await params;

  const existing = await prisma.purchaseRequest.findUnique({
    where: { id },
    include: { catalogItem: { select: { name: true } }, receipt: true },
  });
  if (!existing) return NextResponse.json({ error: "No encontrada." }, { status: 404 });
  if (existing.status !== "RECEIVED_PENDING_REVIEW" || !existing.receipt) {
    return NextResponse.json({ error: "No hay una recepción del equipo pendiente de aprobar." }, { status: 409 });
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
