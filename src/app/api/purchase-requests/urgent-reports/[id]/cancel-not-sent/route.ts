import { randomUUID } from "crypto";
import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { auth } from "@/auth";
import { notifyOwner } from "@/lib/notifications";
import { getPurchaseApproverIds } from "@/lib/guards";
import { formatPurchaseRequestCode } from "@/lib/purchases";
import { getReservedCreditsForGroup, releaseCreditsForGroup } from "@/lib/supplierCredits";
import { CANCEL_NOT_SENT_PREFIX, cancelNotSentBlocker, openSupplierStockoutNotice } from "@/lib/purchaseCancelNotSent";

const schema = z.object({ note: z.string().trim().min(3, "Escribe el motivo (ej. CHEN no tiene stock).") });

// Pedido del usuario 2026-10-10: cancelar una compra que el proveedor nunca
// envió (ver purchaseCancelNotSent.ts). Lo hace quien compró — es quien
// habla con el proveedor — o el admin. La compra queda REJECTED y cerrada
// (rejectionClosedAt), así sale de "Falta enviar", de la deuda y del
// seguimiento de Compras; en el enlace y la hoja del proveedor queda como
// "Cancelado: CHEN sin stock" (ver cancelledNotSentLabel). Se separa
// a un groupId propio (como reject-items) para no mezclar estados con los
// otros productos de la misma solicitud. El reclamo queda marcado "sin
// stock del proveedor" con quién y cuándo.
export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const session = await auth();
  if (!session) return NextResponse.json({ error: "No autorizado." }, { status: 403 });
  const isAdmin = session.user.role === "admin";

  const parsed = schema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: parsed.error.issues[0]?.message ?? "Datos inválidos." }, { status: 400 });

  const { id } = await params;
  const report = await prisma.purchaseRequestUrgentReport.findUnique({
    where: { id },
    select: {
      reviewedByLeadAt: true,
      rejectedAt: true,
      request: {
        include: {
          catalogItem: { select: { name: true } },
          supplier: { select: { name: true } },
          receipt: { select: { id: true } },
          urgentReports: { include: { resolutions: { select: { status: true } } } },
        },
      },
    },
  });
  if (!report) return NextResponse.json({ error: "No encontrado." }, { status: 404 });
  const r = report.request;
  if (!isAdmin && session.user.id !== r.requestedById) {
    return NextResponse.json({ error: "Solo quien hizo la compra (o el admin) puede cancelarla." }, { status: 403 });
  }
  if (!report.reviewedByLeadAt || report.rejectedAt) return NextResponse.json({ error: "Este reclamo todavía no llegó a Compras." }, { status: 409 });
  const blocker = cancelNotSentBlocker(r);
  if (blocker) return NextResponse.json({ error: blocker }, { status: 409 });

  const actorId = isAdmin ? null : session.user.id;
  const now = new Date();
  const note = parsed.data.note;
  const siblings = await prisma.purchaseRequest.count({ where: { groupId: r.groupId, id: { not: r.id } } });
  const groupId = siblings > 0 ? randomUUID() : r.groupId;

  await prisma.$transaction([
    prisma.purchaseRequest.update({
      where: { id: r.id },
      data: {
        groupId,
        status: "REJECTED",
        rejectReason: `${CANCEL_NOT_SENT_PREFIX}: ${note}`,
        rejectionClosedAt: now,
        rejectionClosedNote: `${CANCEL_NOT_SENT_PREFIX}: ${note}`,
      },
    }),
    prisma.purchaseRequestUrgentReport.updateMany({
      where: { requestId: r.id, rejectedAt: null, supplierStockoutAt: null, missingQty: { gt: 0 } },
      data: { supplierStockoutAt: now, supplierStockoutById: actorId },
    }),
  ]);

  // Crédito reservado para esa solicitud: si ya no queda nada que pagar (o
  // supera lo que queda), vuelve a quedar libre con el proveedor.
  if (siblings === 0) {
    await releaseCreditsForGroup(r.groupId).catch(() => null);
  } else {
    const keptTotal = (await prisma.purchaseRequest.findMany({ where: { groupId: r.groupId }, select: { totalCost: true } })).reduce((s, x) => s + x.totalCost, 0);
    const reserved = (await getReservedCreditsForGroup(r.groupId)).reduce((s, c) => s + c.amount, 0);
    if (reserved > keptTotal + 0.001) await releaseCreditsForGroup(r.groupId).catch(() => null);
  }

  try {
    await openSupplierStockoutNotice({
      catalogItemId: r.catalogItemId,
      catalogItemName: r.catalogItem.name,
      supplierName: r.supplier.name,
      qty: r.quantity,
      reporterId: actorId ?? r.requestedById,
    });
  } catch (err) {
    console.error("[cancel-not-sent] aviso a marketing:", err);
  }

  // Solo aviso: a quien aprueba compras y, si canceló el admin, a quien compró.
  const code = r.requestNumber ? `${formatPurchaseRequestCode(r.requestNumber)} · ` : "";
  const body = `${code}${r.catalogItem.name} (${r.quantity} un.) · ${r.supplier.name} — el proveedor no la envió: ${note}. No se paga nada.`;
  const notifyIds = new Set(await getPurchaseApproverIds());
  if (isAdmin && r.requestedById) notifyIds.add(r.requestedById);
  if (actorId) notifyIds.delete(actorId);
  for (const ownerId of notifyIds) {
    await notifyOwner(ownerId, { title: "🚫 Compra cancelada (solo aviso)", body, url: "/area/workspace?tab=compras" }).catch(() => null);
  }

  return NextResponse.json({ ok: true });
}
