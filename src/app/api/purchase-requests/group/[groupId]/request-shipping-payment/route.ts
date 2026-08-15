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
  // Confirmado 2026-08-14: ya no exige que Inventario haya confirmado
  // recepción (RECEIVED) — solo que la solicitud esté aprobada, mismo
  // criterio que showShippingSection en MyPurchaseRequests.tsx.
  if (r0.status === "PENDING_APPROVAL" || r0.status === "REJECTED") {
    return NextResponse.json({ error: "Esta solicitud todavía no está aprobada." }, { status: 409 });
  }
  if (r0.shippingPaidAt) {
    return NextResponse.json({ error: "El flete ya está pagado." }, { status: 409 });
  }
  if (r0.shippingPaymentMethod === "PETTY_CASH") {
    return NextResponse.json({ error: "Este flete se paga con caja chica — no se pide al administrador." }, { status: 409 });
  }
  if (!r0.carrierBankAccountId) {
    return NextResponse.json({ error: "Falta registrar la cuenta bancaria del transportista antes de pedir el pago." }, { status: 409 });
  }

  const isAdmin = session.user.role === "admin";
  const requestedAt = new Date();
  await prisma.purchaseRequest.updateMany({
    where: { groupId },
    data: { shippingPaymentRequestedAt: requestedAt, shippingPaymentRequestedById: isAdmin ? null : session.user.id },
  });

  const names = rows.map((r) => r.catalogItem.name).join(", ");
  const finLeader = await prisma.user.findFirst({ where: { isLeader: true, leadsDept: { code: "FIN" } }, select: { id: true } });
  const pushTargets = new Set<string>(["admin"]);
  if (finLeader) pushTargets.add(finLeader.id);
  await Promise.all(
    [...pushTargets].map((ownerId) =>
      sendPushToOwner(ownerId, {
        title: "🚚 Piden pagar un flete",
        body: `${names} — ${r0.carrier?.name ?? "transportista"} · $${(r0.shippingCostTotal ?? 0).toFixed(2)}`,
        url: ownerId === "admin" ? "/admin" : "/area/workspace?tab=compras&ptab=finanzas",
      }).catch(() => null)
    )
  );

  const updated = await prisma.purchaseRequest.findMany({ where: { groupId } });
  return NextResponse.json(updated);
}
