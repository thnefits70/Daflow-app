import { NextResponse } from "next/server";
import { auth } from "@/auth";
import { prisma } from "@/lib/prisma";
import { canConfirmCancelledGuideFulfillmentRemoval, dbUserId } from "@/lib/guards";
import { notifyInventoryLeadCancelledGuidesReady } from "@/lib/cancelledGuides";

// Agregado 2026-09-03, pedido explícito del usuario: Yair confirma que sacó
// del área de Fulfillment TODAS las guías gestionadas de este lote — solo
// se puede confirmar un lote que Bryan ya gestionó (batchManagedAt). Corre
// en paralelo con Heidy cargando productos: si alguna guía de este lote ya
// tiene productos cargados, queda lista para Daniel recién ahora.
export async function POST(_req: Request, { params }: { params: Promise<{ batchCode: string }> }) {
  const session = await auth();
  if (!(await canConfirmCancelledGuideFulfillmentRemoval()) || !session) return NextResponse.json({ error: "No autorizado." }, { status: 403 });

  const { batchCode } = await params;
  const pending = await prisma.cancelledGuideReport.findMany({
    where: { batchCode, batchManagedAt: { not: null }, fulfillmentRemovedAt: null },
    select: { id: true, code: true, itemsAssignedAt: true },
  });
  if (pending.length === 0) return NextResponse.json({ error: "Este lote ya fue confirmado, no fue gestionado todavía, o no existe." }, { status: 409 });

  await prisma.cancelledGuideReport.updateMany({
    where: { id: { in: pending.map((r) => r.id) } },
    data: { fulfillmentRemovedAt: new Date(), fulfillmentRemovedById: dbUserId(session.user.id) },
  });

  const readyCodes = pending.filter((r) => r.itemsAssignedAt).map((r) => r.code);
  await notifyInventoryLeadCancelledGuidesReady(readyCodes);
  return NextResponse.json({ ok: true, count: pending.length });
}
