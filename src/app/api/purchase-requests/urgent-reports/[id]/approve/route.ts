import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { auth } from "@/auth";
import { canActOnPurchaseReceiving } from "@/lib/guards";
import { sendPushToOwner } from "@/lib/webPush";
import { isWithinCreditClaimWindow } from "@/lib/purchaseUrgent";

// Confirmado 2026-08-18: pedido explícito del usuario — Daniel (líder de
// Inventario) revisa un "Informar urgente" que subió su equipo (ver
// [id]/urgent-report/route.ts) antes de que le llegue a admin/solicitante o
// aparezca en la bandeja de Bryan (urgent-reports/route.ts, que ahora solo
// muestra reportedByLeadAt no nulo) — mismo criterio que approve-receipt.
export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const session = await auth();
  if (!(await canActOnPurchaseReceiving()) || !session) return NextResponse.json({ error: "No autorizado." }, { status: 403 });

  const { id } = await params;
  const existing = await prisma.purchaseRequestUrgentReport.findUnique({
    where: { id },
    include: { request: { select: { paidAt: true, requestedById: true, unitCost: true, catalogItem: { select: { name: true } } } } },
  });
  if (!existing) return NextResponse.json({ error: "No encontrado." }, { status: 404 });
  if (existing.reviewedByLeadAt) return NextResponse.json({ error: "Ya fue revisado." }, { status: 409 });

  const isAdmin = session.user.role === "admin";
  const updated = await prisma.purchaseRequestUrgentReport.update({
    where: { id },
    data: { reviewedByLeadId: isAdmin ? null : session.user.id, reviewedByLeadAt: new Date() },
  });

  const totalAffected = existing.damagedQty + existing.missingQty + existing.incompleteQty + existing.differentQty;
  const disputedValue = totalAffected * existing.request.unitCost;
  const withinCreditWindow = existing.request.paidAt ? isWithinCreditClaimWindow(existing.request.paidAt) : true;
  const windowNote = withinCreditWindow ? "" : " · ⚠️ ya pasaron 7 días desde el pago, el proveedor puede no aprobar crédito";

  const notifyTargets = new Set<string>(["admin"]);
  if (existing.request.requestedById) notifyTargets.add(existing.request.requestedById);
  await Promise.all(
    [...notifyTargets].map((ownerId) =>
      sendPushToOwner(ownerId, {
        title: "🚨 Reporte urgente de mercadería",
        body: `${existing.request.catalogItem.name} — ${totalAffected} un. afectadas · $${disputedValue.toFixed(2)} en disputa${windowNote}`,
        url: ownerId === "admin" ? "/admin" : "/area/workspace",
      }).catch(() => null)
    )
  );

  return NextResponse.json(updated);
}
