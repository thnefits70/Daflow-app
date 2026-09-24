import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { canActOnMerchandiseReentry, canApproveMerchandiseReentry, canCloseMerchandiseReentry } from "@/lib/guards";
import { getEcuadorWeekBounds, groupItemsForWriteOff, type MerchandiseReentryItemForGrouping } from "@/lib/merchandiseReentry";
import { autoCloseFinishedWeeklyWriteOffBatches } from "@/lib/inventoryAutoFlows";

const ITEM_INCLUDE = {
  catalogItem: { select: { name: true, justCode: true } },
  damageReason: { select: { name: true } },
  batch: { select: { code: true, createdAt: true, createdBy: { select: { name: true } } } },
  damageConfirmedBy: { select: { name: true } },
} as const;

type BatchWithItems = {
  id: string;
  weekStart: Date;
  weekEnd: Date;
  justWrittenOffAt: Date | null;
  nairobyConfirmedAt: Date | null;
  nairobyConfirmedBy: { name: string } | null;
  items: (MerchandiseReentryItemForGrouping & {
    disposalDecision: boolean | null;
    damageConfirmedAt: Date | null;
    damageConfirmedBy: { name: string } | null;
    batch: { code: string; createdAt: Date; createdBy: { name: string } };
  })[];
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
      // Confirmado 2026-09-24, pedido de Nairoby: para confirmar la baja
      // necesita ver de dónde salió cada unidad (devolución, lote, quién la
      // recibió, quién confirmó el daño) y las fotos — antes solo veía
      // nombre y cantidad y no tenía cómo comprobarlo.
      breakdown: g.breakdown.map((row) => {
        const item = b.items.find((i) => i.id === row.id);
        return {
          ...row,
          disposalDecision: item?.disposalDecision ?? null,
          receivedByName: item?.batch.createdBy.name ?? null,
          receivedAt: item?.batch.createdAt ?? null,
          damageConfirmedByName: item?.damageConfirmedBy?.name ?? null,
          damageConfirmedAt: item?.damageConfirmedAt ?? null,
          photoUrls: item?.photoUrls ?? [],
        };
      }),
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
  // Una semana que quedó vacía (Daniel pasó todo a reclamo con proveedor,
  // ver reentrySupplierClaim.ts) ya no tiene nada que verificar.
  const needsNairobyVerification = batches.filter((b) => b.justWrittenOffAt && !b.nairobyConfirmedAt && b.items.length > 0);
  const needsDisposalDecision = batches.filter((b) => b.nairobyConfirmedAt && b.items.some((i) => i.disposalDecision === null));

  return NextResponse.json({
    currentWeek: currentWeek && currentWeek.items.length > 0 ? serialize(currentWeek) : null,
    // Daniel (canAct) también las ve desde 2026-09-24: puede aclarar que un
    // producto no es baja sino reclamo al proveedor, hasta que Nairoby decida.
    needsNairobyVerification: canClose || canAct ? needsNairobyVerification.map(serialize) : [],
    needsDisposalDecision: canClose || canAct ? needsDisposalDecision.map(serialize) : [],
  });
}
