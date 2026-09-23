import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/auth";
import { prisma } from "@/lib/prisma";
import { canActOnPurchaseReceiving } from "@/lib/guards";
import { recordKardexEntry } from "@/lib/stockKardex";
import { effectiveUnitCost } from "@/lib/purchases";

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
    include: { report: { select: { request: { select: { catalogItemId: true, unitCost: true, quantity: true, shippingIncluded: true, shippingCostTotal: true } } } } },
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
  if (qty > 0) {
    await recordKardexEntry({
      catalogItemId: request.catalogItemId,
      type: "IN",
      quantity: qty,
      unitCost: effectiveUnitCost(request),
      occurredAt: new Date(),
    }).catch((err) => console.error("[approve-replacement] No se pudo registrar la entrada de Kardex:", err));
  }

  return NextResponse.json(updated);
}
