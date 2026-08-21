import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { canActOnMerchandiseReentry, canCloseMerchandiseReentry } from "@/lib/guards";
import { getEcuadorWeekBounds, groupItemsForWriteOff, type MerchandiseReentryItemForGrouping } from "@/lib/merchandiseReentry";

const ITEM_INCLUDE = { catalogItem: { select: { name: true } }, damageReason: { select: { name: true } }, batch: { select: { code: true } } } as const;

type BatchWithItems = {
  id: string;
  weekStart: Date;
  weekEnd: Date;
  justWrittenOffAt: Date | null;
  justWrittenOffBy: { name: string } | null;
  nairobyConfirmedAt: Date | null;
  nairobyConfirmedBy: { name: string } | null;
  items: (MerchandiseReentryItemForGrouping & { disposalDecision: boolean | null })[];
};

function serialize(b: BatchWithItems) {
  return {
    id: b.id,
    weekStart: b.weekStart,
    weekEnd: b.weekEnd,
    justWrittenOffAt: b.justWrittenOffAt,
    justWrittenOffByName: b.justWrittenOffBy?.name ?? null,
    nairobyConfirmedAt: b.nairobyConfirmedAt,
    nairobyConfirmedByName: b.nairobyConfirmedBy?.name ?? null,
    groups: groupItemsForWriteOff(b.items).map((g) => ({
      ...g,
      breakdown: g.breakdown.map((row) => ({ ...row, disposalDecision: b.items.find((i) => i.id === row.id)?.disposalDecision ?? null })),
    })),
  };
}

// Resumen del ciclo semanal de productos dañados "no solucionados" (ver
// MerchandiseReentryItem.damageSolved) — acumulado en tiempo real, corte
// del sábado por Daniel, verificación + doble confirmación + disposición
// por Nairoby. Pedido 2026-08-21.
export async function GET() {
  const [canAct, canClose] = await Promise.all([canActOnMerchandiseReentry(), canCloseMerchandiseReentry()]);
  if (!canAct && !canClose) return NextResponse.json({ error: "No autorizado." }, { status: 403 });

  const { weekStart: currentWeekStart } = getEcuadorWeekBounds(new Date());

  const batches = (await prisma.merchandiseWeeklyWriteOffBatch.findMany({
    where: { OR: [{ justWrittenOffAt: null }, { nairobyConfirmedAt: null }, { weekStart: currentWeekStart }] },
    orderBy: { weekStart: "asc" },
    include: { items: { include: ITEM_INCLUDE }, justWrittenOffBy: { select: { name: true } }, nairobyConfirmedBy: { select: { name: true } } },
  })) as unknown as BatchWithItems[];

  const currentWeek = batches.find((b) => b.weekStart.getTime() === currentWeekStart.getTime()) ?? null;
  const needsJustWriteOff = batches.filter((b) => !b.justWrittenOffAt && b.weekEnd.getTime() < Date.now());
  const needsNairobyVerification = batches.filter((b) => b.justWrittenOffAt && !b.nairobyConfirmedAt);
  const needsDisposalDecision = batches.filter((b) => b.nairobyConfirmedAt && b.items.some((i) => i.disposalDecision === null));

  return NextResponse.json({
    currentWeek: currentWeek && currentWeek.items.length > 0 ? serialize(currentWeek) : null,
    needsJustWriteOff: canAct ? needsJustWriteOff.map(serialize) : [],
    needsNairobyVerification: canClose ? needsNairobyVerification.map(serialize) : [],
    needsDisposalDecision: canClose ? needsDisposalDecision.map(serialize) : [],
  });
}
