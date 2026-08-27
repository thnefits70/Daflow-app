import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { auth } from "@/auth";
import { canActOnPurchaseReceiving } from "@/lib/guards";
import { sendPushToOwner } from "@/lib/webPush";
import { isWithinCreditClaimWindow } from "@/lib/purchaseUrgent";

const schema = z.object({
  // Confirmado 2026-08-27: pedido explícito del usuario — el equipo que
  // cuenta (Bryan/Joel) nunca escribe cuántas unidades faltan porque no ve
  // lo que se pidió comprar; el servidor ya deja una cantidad faltante
  // calculada al crear el reporte (existing.quantity - lo contado), pero es
  // Daniel quien la ve y decide (él sí ve el total pedido) antes de mandarlo
  // a Compras — puede dejarla igual o ajustarla.
  missingQty: z.number().int().nonnegative().optional(),
});

// Confirmado 2026-08-18: pedido explícito del usuario — Daniel (líder de
// Inventario) revisa un "Informar urgente" que subió su equipo (ver
// [id]/urgent-report/route.ts) antes de que le llegue a admin/solicitante o
// aparezca en la bandeja de Bryan (urgent-reports/route.ts, que ahora solo
// muestra reportedByLeadAt no nulo) — mismo criterio que approve-receipt.
export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const session = await auth();
  if (!(await canActOnPurchaseReceiving()) || !session) return NextResponse.json({ error: "No autorizado." }, { status: 403 });

  const { id } = await params;
  const body = await req.json().catch(() => ({}));
  const parsed = schema.safeParse(body ?? {});
  if (!parsed.success) return NextResponse.json({ error: parsed.error.issues[0]?.message ?? "Datos inválidos." }, { status: 400 });

  const existing = await prisma.purchaseRequestUrgentReport.findUnique({
    where: { id },
    include: { request: { select: { quantity: true, paidAt: true, requestedById: true, unitCost: true, catalogItem: { select: { name: true } } } } },
  });
  if (!existing) return NextResponse.json({ error: "No encontrado." }, { status: 404 });
  if (existing.reviewedByLeadAt) return NextResponse.json({ error: "Ya fue revisado." }, { status: 409 });

  const finalMissingQty = parsed.data.missingQty ?? existing.missingQty;
  const flaggedQty = existing.damagedQty + existing.incompleteQty + existing.differentQty;
  if (flaggedQty + finalMissingQty > existing.request.quantity) {
    return NextResponse.json({ error: `La cantidad faltante no puede dejar el total en más de lo pedido (${existing.request.quantity} un.).` }, { status: 400 });
  }

  const isAdmin = session.user.role === "admin";
  const updated = await prisma.purchaseRequestUrgentReport.update({
    where: { id },
    data: { missingQty: finalMissingQty, reviewedByLeadId: isAdmin ? null : session.user.id, reviewedByLeadAt: new Date() },
  });

  const totalAffected = existing.damagedQty + finalMissingQty + existing.incompleteQty + existing.differentQty;
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
