import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { canActOnMerchandiseReentry, canApproveMerchandiseReentry, canCloseMerchandiseReentry } from "@/lib/guards";
import { getEcuadorWeekBounds, groupItemsForWriteOff, type MerchandiseReentryItemForGrouping } from "@/lib/merchandiseReentry";
import { autoCloseFinishedWeeklyWriteOffBatches } from "@/lib/inventoryAutoFlows";

const ITEM_INCLUDE = { catalogItem: { select: { name: true, justCode: true } }, damageReason: { select: { name: true } }, batch: { select: { code: true } } } as const;

type BatchWithItems = {
  id: string;
  weekStart: Date;
  weekEnd: Date;
  justWrittenOffAt: Date | null;
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
// automático del sábado (desde 2026-09-23, antes lo confirmaba Daniel tras
// darlo de baja en Just), verificación + doble confirmación + disposición
// por Nairoby. Pedido 2026-08-21.
export async function GET() {
  const [canAct, canApprove, canClose] = await Promise.all([canActOnMerchandiseReentry(), canApproveMerchandiseReentry(), canCloseMerchandiseReentry()]);
  if (!canAct && !canApprove && !canClose) return NextResponse.json({ error: "No autorizado." }, { status: 403 });

  // Cierra ya cualquier semana que terminó, por si el cron diario todavía
  // no pasó — así Nairoby la ve apenas entra.
  await autoCloseFinishedWeeklyWriteOffBatches().catch(() => 0);

  const { weekStart: currentWeekStart } = getEcuadorWeekBounds(new Date());

  const batches = (await prisma.merchandiseWeeklyWriteOffBatch.findMany({
    where: { OR: [{ justWrittenOffAt: null }, { nairobyConfirmedAt: null }, { weekStart: currentWeekStart }] },
    orderBy: { weekStart: "asc" },
    include: { items: { include: ITEM_INCLUDE }, nairobyConfirmedBy: { select: { name: true } } },
  })) as unknown as BatchWithItems[];

  const currentWeek = batches.find((b) => b.weekStart.getTime() === currentWeekStart.getTime()) ?? null;
  const needsNairobyVerification = batches.filter((b) => b.justWrittenOffAt && !b.nairobyConfirmedAt);
  const needsDisposalDecision = batches.filter((b) => b.nairobyConfirmedAt && b.items.some((i) => i.disposalDecision === null));

  return NextResponse.json({
    currentWeek: currentWeek && currentWeek.items.length > 0 ? serialize(currentWeek) : null,
    needsNairobyVerification: canClose ? needsNairobyVerification.map(serialize) : [],
    needsDisposalDecision: canClose ? needsDisposalDecision.map(serialize) : [],
  });
}
