import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { auth } from "@/auth";
import { canSubmitPurchaseRequests } from "@/lib/guards";
import { sendPushToOwner } from "@/lib/webPush";

// Confirmado 2026-08-03: cuando el flete quedó pendiente hasta la entrega,
// quien solicitó la compra avisa con un clic que ya llegó la mercadería y
// que corresponde pagar el flete — un empujón manual en vez de asumir que
// el admin se acuerda solo.
export async function POST(_req: NextRequest, { params }: { params: Promise<{ groupId: string }> }) {
  const session = await auth();
  if (!(await canSubmitPurchaseRequests()) || !session) return NextResponse.json({ error: "No autorizado." }, { status: 403 });

  const { groupId } = await params;
  const rows = await prisma.purchaseRequest.findMany({
    where: { groupId },
    include: { catalogItem: { select: { name: true } }, carrier: { select: { name: true } } },
  });
  if (rows.length === 0) return NextResponse.json({ error: "No encontrada." }, { status: 404 });
  const r0 = rows[0];
  if (r0.shippingIncluded || r0.shippingPaymentTiming !== "ON_DELIVERY") {
    return NextResponse.json({ error: "Esta compra no tiene un flete pendiente para solicitar." }, { status: 409 });
  }
  if (r0.shippingPaidAt) {
    return NextResponse.json({ error: "El flete ya está pagado." }, { status: 409 });
  }

  const isAdmin = session.user.role === "admin";
  const requestedAt = new Date();
  await prisma.purchaseRequest.updateMany({
    where: { groupId },
    data: { shippingPaymentRequestedAt: requestedAt, shippingPaymentRequestedById: isAdmin ? null : session.user.id },
  });

  const names = rows.map((r) => r.catalogItem.name).join(", ");
  await sendPushToOwner("admin", {
    title: "🚚 Piden pagar un flete",
    body: `${names} — ${r0.carrier?.name ?? "transportista"} · $${(r0.shippingCostTotal ?? 0).toFixed(2)}`,
    url: "/admin",
  }).catch(() => null);

  const updated = await prisma.purchaseRequest.findMany({ where: { groupId } });
  return NextResponse.json(updated);
}
