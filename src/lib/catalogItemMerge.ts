import { prisma } from "@/lib/prisma";
import type { Prisma } from "@/generated/prisma/client";

// Confirmado 2026-09-22, pedido explícito del usuario (solo admin): dos
// herramientas sobre la Base de datos de productos —
// 1. JUNTAR: un ID duplicado (el que se quita) se une al ID oficial. Todo lo
//    que colgaba del duplicado (compras, reingresos, salidas, ventas
//    externas, lotes de caducidad, combos, Kardex…) pasa al oficial, el
//    stock se suma y el costo promedio queda ponderado. El duplicado se
//    borra. Confirmado con el usuario: "todo pasa al oficial".
// 2. ELIMINAR: un ID mal creado que no tiene NADA registrado. Si tiene algo
//    (ej. un reingreso mal vinculado), no se borra — se usa JUNTAR para
//    pasar eso al producto correcto, así nunca se pierde un registro real.
// Cada acción deja una fila en CatalogItemMerge con la foto de lo que era.

export type MergeCounts = {
  purchases: number;
  reentryItems: number;
  outflowItems: number;
  externalSaleItems: number;
  personalPurchaseItems: number;
  cancelledGuideItems: number;
  fulfillmentItems: number;
  comboComponents: number;
  expirationLots: number;
  kardexMovements: number;
  // Códigos de Rocket, propuesta de Análisis de Mercado, producto agotado, estado ATOM.
  otherLinks: number;
};

export type MergeItemSnapshot = {
  id: string;
  name: string;
  justCode: string | null;
  photo: string | null;
  balance: number;
  avgCost: number;
  counts: MergeCounts;
};

export type MergePreview = {
  removed: MergeItemSnapshot;
  official: MergeItemSnapshot | null;
  // Solo en JUNTAR: cómo queda el oficial después.
  result: { balance: number; avgCost: number } | null;
  blockers: string[];
};

function combineAvgCost(balA: number, avgA: number, balB: number, avgB: number, fallback: number): number {
  if (balA > 0 && balB > 0) return (balA * avgA + balB * avgB) / (balA + balB);
  if (balA > 0) return avgA;
  if (balB > 0) return avgB;
  return fallback;
}

async function snapshot(itemId: string): Promise<(MergeItemSnapshot & { awaitingDropiId: boolean; hasPendingCountAdjustment: boolean }) | null> {
  const item = await prisma.purchaseCatalogItem.findUnique({
    where: { id: itemId },
    select: { id: true, name: true, justCode: true, photos: true, awaitingDropiId: true, physicalCountAdjustmentRequest: { select: { id: true } } },
  });
  if (!item) return null;
  const [purchases, reentryItems, outflowItems, externalSaleItems, personalA, personalB, cancelledGuideItems, fulfillmentItems, comboComponents, expirationLots, kardex, latest, rocket, proposal, stockout, atom] =
    await Promise.all([
      prisma.purchaseRequest.count({ where: { catalogItemId: itemId } }),
      prisma.merchandiseReentryItem.count({ where: { catalogItemId: itemId } }),
      prisma.merchandiseOutflowItem.count({ where: { catalogItemId: itemId } }),
      prisma.externalSaleItem.count({ where: { catalogItemId: itemId } }),
      prisma.personalPurchaseItem.count({ where: { catalogItemId: itemId } }),
      prisma.personalPurchaseItem.count({ where: { confirmedCatalogItemId: itemId, NOT: { catalogItemId: itemId } } }),
      prisma.cancelledGuideItem.count({ where: { catalogItemId: itemId } }),
      prisma.fulfillmentRequestItem.count({ where: { catalogItemId: itemId } }),
      prisma.dropiComboComponent.count({ where: { catalogItemId: itemId } }),
      prisma.expirationCohort.count({ where: { catalogItemId: itemId } }),
      // La línea SEED en 0 que todo producto recibió al arrancar INVESTOCK no
      // es un movimiento real — no se cuenta.
      prisma.stockKardexEntry.count({ where: { catalogItemId: itemId, NOT: { type: "SEED", quantity: 0 } } }),
      prisma.stockKardexEntry.findFirst({ where: { catalogItemId: itemId }, orderBy: [{ occurredAt: "desc" }, { createdAt: "desc" }] }),
      prisma.rocketCodeMapping.count({ where: { catalogItemId: itemId } }),
      prisma.marketProductProposal.count({ where: { catalogItemId: itemId } }),
      prisma.stockoutProduct.count({ where: { catalogItemId: itemId } }),
      prisma.atomProductStatus.count({ where: { matchedCatalogItemId: itemId } }),
    ]);
  return {
    id: item.id,
    name: item.name,
    justCode: item.justCode,
    photo: item.photos[0] ?? null,
    balance: latest?.balanceAfter ?? 0,
    avgCost: latest?.avgCostAfter ?? 0,
    counts: {
      purchases,
      reentryItems,
      outflowItems,
      externalSaleItems,
      personalPurchaseItems: personalA + personalB,
      cancelledGuideItems,
      fulfillmentItems,
      comboComponents,
      expirationLots,
      kardexMovements: kardex,
      otherLinks: rocket + proposal + stockout + atom,
    },
    awaitingDropiId: item.awaitingDropiId,
    hasPendingCountAdjustment: !!item.physicalCountAdjustmentRequest,
  };
}

function hasAnyRecord(c: MergeCounts): boolean {
  return Object.values(c).some((n) => n > 0);
}

function strip(s: MergeItemSnapshot & { awaitingDropiId: boolean; hasPendingCountAdjustment: boolean }): MergeItemSnapshot {
  const { awaitingDropiId, hasPendingCountAdjustment, ...rest } = s;
  void awaitingDropiId;
  void hasPendingCountAdjustment;
  return rest;
}

export async function previewCatalogItemAction(params: { removedId: string; officialId: string | null }): Promise<MergePreview | { error: string }> {
  const removed = await snapshot(params.removedId);
  if (!removed) return { error: "El ID a quitar ya no existe." };

  // ---- ELIMINAR ----
  if (!params.officialId) {
    const blockers: string[] = [];
    if (hasAnyRecord(removed.counts)) {
      blockers.push("Este ID ya tiene cosas registradas (ver conteos). No se puede borrar sin perderlas: usa \"Juntar\" para pasarlas al producto correcto.");
    }
    if (removed.hasPendingCountAdjustment) blockers.push("Tiene un ajuste por conteo físico pendiente de aprobar.");
    return { removed: strip(removed), official: null, result: null, blockers };
  }

  // ---- JUNTAR ----
  if (params.officialId === params.removedId) return { error: "Elige dos productos distintos." };
  const official = await snapshot(params.officialId);
  if (!official) return { error: "El ID oficial ya no existe." };

  const blockers: string[] = [];
  if (removed.awaitingDropiId) blockers.push(`"${removed.name}" todavía espera su ID real de Dropi (Análisis de Mercado). Termina ese paso primero.`);
  if (official.awaitingDropiId) blockers.push(`"${official.name}" todavía espera su ID real de Dropi (Análisis de Mercado). Termina ese paso primero.`);
  if (removed.hasPendingCountAdjustment) blockers.push(`"${removed.name}" tiene un ajuste por conteo físico pendiente. Apruébalo o recházalo primero.`);

  const result = {
    balance: official.balance + removed.balance,
    avgCost: combineAvgCost(official.balance, official.avgCost, removed.balance, removed.avgCost, official.avgCost || removed.avgCost),
  };
  return { removed: strip(removed), official: strip(official), result, blockers };
}

export async function deleteCatalogItem(params: { itemId: string; performedById: string | null; performedByName: string }): Promise<{ ok: true } | { ok: false; error: string }> {
  const preview = await previewCatalogItemAction({ removedId: params.itemId, officialId: null });
  if ("error" in preview) return { ok: false, error: preview.error };
  if (preview.blockers.length > 0) return { ok: false, error: preview.blockers[0] };

  await prisma.$transaction(async (tx) => {
    // Solo queda la línea SEED en 0 (si no, preview habría bloqueado).
    await tx.stockKardexEntry.deleteMany({ where: { catalogItemId: params.itemId } });
    await tx.purchaseCatalogItem.delete({ where: { id: params.itemId } });
    await tx.catalogItemMerge.create({
      data: {
        kind: "DELETE",
        removedItemId: preview.removed.id,
        removedName: preview.removed.name,
        removedJustCode: preview.removed.justCode,
        summary: { removed: preview.removed } as unknown as Prisma.InputJsonValue,
        performedById: params.performedById,
        performedByName: params.performedByName,
      },
    });
  });
  return { ok: true };
}

export async function mergeCatalogItems(params: {
  removedId: string;
  officialId: string;
  performedById: string | null;
  performedByName: string;
}): Promise<{ ok: true; balance: number; avgCost: number } | { ok: false; error: string }> {
  const preview = await previewCatalogItemAction({ removedId: params.removedId, officialId: params.officialId });
  if ("error" in preview) return { ok: false, error: preview.error };
  if (preview.blockers.length > 0) return { ok: false, error: preview.blockers[0] };
  const R = params.removedId;
  const O = params.officialId;

  await prisma.$transaction(
    async (tx) => {
      const [removedItem, officialItem] = await Promise.all([
        tx.purchaseCatalogItem.findUniqueOrThrow({ where: { id: R } }),
        tx.purchaseCatalogItem.findUniqueOrThrow({ where: { id: O } }),
      ]);

      // ---- Kardex: se juntan los dos historiales en orden de fecha. Cada
      // línea ya guarda el saldo/costo de SU producto en ese momento; el
      // saldo combinado es simplemente la suma de los dos, y el costo el
      // promedio ponderado. Así no hay que reinterpretar ningún tipo de
      // movimiento (SEED, corte de Just, ajustes…) — y las salidas
      // conservan el costo con el que se valoraron ese día (unitCost no se toca).
      const entries = await tx.stockKardexEntry.findMany({
        where: { catalogItemId: { in: [R, O] } },
        orderBy: [{ occurredAt: "asc" }, { createdAt: "asc" }],
        select: { id: true, catalogItemId: true, balanceAfter: true, avgCostAfter: true },
      });
      const state = { [O]: { bal: 0, avg: 0 }, [R]: { bal: 0, avg: 0 } } as Record<string, { bal: number; avg: number }>;
      const updates: { id: string; balanceAfter: number; avgCostAfter: number }[] = [];
      for (const e of entries) {
        state[e.catalogItemId] = { bal: e.balanceAfter, avg: e.avgCostAfter };
        const o = state[O];
        const r = state[R];
        updates.push({ id: e.id, balanceAfter: o.bal + r.bal, avgCostAfter: combineAvgCost(o.bal, o.avg, r.bal, r.avg, e.avgCostAfter) });
      }
      for (const u of updates) {
        await tx.stockKardexEntry.update({ where: { id: u.id }, data: { catalogItemId: O, balanceAfter: u.balanceAfter, avgCostAfter: u.avgCostAfter } });
      }

      // ---- Registros operativos: se pasan tal cual al oficial.
      await tx.purchaseRequest.updateMany({ where: { catalogItemId: R }, data: { catalogItemId: O } });
      await tx.merchandiseReentryItem.updateMany({ where: { catalogItemId: R }, data: { catalogItemId: O } });
      await tx.merchandiseOutflowItem.updateMany({ where: { catalogItemId: R }, data: { catalogItemId: O } });
      await tx.externalSaleItem.updateMany({ where: { catalogItemId: R }, data: { catalogItemId: O } });
      await tx.personalPurchaseItem.updateMany({ where: { catalogItemId: R }, data: { catalogItemId: O } });
      await tx.personalPurchaseItem.updateMany({ where: { confirmedCatalogItemId: R }, data: { confirmedCatalogItemId: O } });
      await tx.cancelledGuideItem.updateMany({ where: { catalogItemId: R }, data: { catalogItemId: O } });
      await tx.fulfillmentRequestItem.updateMany({ where: { catalogItemId: R }, data: { catalogItemId: O } });
      await tx.fulfillmentRequestVariantNote.updateMany({ where: { catalogItemId: R }, data: { catalogItemId: O } });
      await tx.expirationCohort.updateMany({ where: { catalogItemId: R }, data: { catalogItemId: O } });
      await tx.rocketCodeMapping.updateMany({ where: { catalogItemId: R }, data: { catalogItemId: O } });
      await tx.atomProductStatus.updateMany({ where: { matchedCatalogItemId: R }, data: { matchedCatalogItemId: O } });
      await tx.supplierStockoutReport.updateMany({ where: { catalogItemId: R }, data: { catalogItemId: O } });

      // Combos: si un mismo combo ya traía los dos productos, se suman las
      // unidades en una sola línea en vez de dejar dos líneas del mismo producto.
      const removedComponents = await tx.dropiComboComponent.findMany({ where: { catalogItemId: R } });
      for (const comp of removedComponents) {
        const existing = await tx.dropiComboComponent.findFirst({ where: { comboId: comp.comboId, catalogItemId: O } });
        if (existing) {
          await tx.dropiComboComponent.update({ where: { id: existing.id }, data: { quantity: existing.quantity + comp.quantity } });
          await tx.dropiComboComponent.delete({ where: { id: comp.id } });
        } else {
          await tx.dropiComboComponent.update({ where: { id: comp.id }, data: { catalogItemId: O } });
        }
      }

      // Vínculos "uno por producto": se pasan solo si el oficial no tiene
      // ya el suyo (si lo tiene, el del duplicado queda sin producto).
      const [officialProposal, officialStockout] = await Promise.all([
        tx.marketProductProposal.findFirst({ where: { catalogItemId: O }, select: { id: true } }),
        tx.stockoutProduct.findFirst({ where: { catalogItemId: O }, select: { id: true } }),
      ]);
      if (!officialProposal) await tx.marketProductProposal.updateMany({ where: { catalogItemId: R }, data: { catalogItemId: O } });
      if (!officialStockout) await tx.stockoutProduct.updateMany({ where: { catalogItemId: R }, data: { catalogItemId: O } });

      // Datos del producto: el oficial manda; solo se completa lo que le falte.
      // Si el oficial no tenía código de Just y el duplicado sí, el código
      // pasa al oficial (se libera primero porque justCode es único).
      const inheritJustCode = !officialItem.justCode && !!removedItem.justCode;
      if (inheritJustCode) await tx.purchaseCatalogItem.update({ where: { id: R }, data: { justCode: null } });
      await tx.purchaseCatalogItem.update({
        where: { id: O },
        data: {
          hasExpiration: officialItem.hasExpiration || removedItem.hasExpiration,
          description: officialItem.description ?? removedItem.description,
          code: officialItem.code ?? removedItem.code,
          nicho: officialItem.nicho ?? removedItem.nicho,
          bodega: officialItem.bodega ?? removedItem.bodega,
          ...(inheritJustCode ? { justCode: removedItem.justCode } : {}),
          ...(officialItem.photos.length === 0 && removedItem.photos.length > 0
            ? { photos: removedItem.photos, pendingRegistration: removedItem.pendingRegistration }
            : {}),
        },
      });

      // Lo que queda del duplicado son estadísticas calculadas (rotación,
      // comparaciones con Just, sugerencias) — se borran con el producto
      // (onDelete: Cascade) y se recalculan solas con el oficial.
      await tx.purchaseCatalogItem.delete({ where: { id: R } });

      await tx.catalogItemMerge.create({
        data: {
          kind: "MERGE",
          removedItemId: R,
          removedName: removedItem.name,
          removedJustCode: removedItem.justCode,
          officialItemId: O,
          officialName: officialItem.name,
          officialJustCode: officialItem.justCode,
          summary: { removed: preview.removed, official: preview.official, result: preview.result } as unknown as Prisma.InputJsonValue,
          performedById: params.performedById,
          performedByName: params.performedByName,
        },
      });
    },
    { timeout: 120000, maxWait: 20000 }
  );

  return { ok: true, balance: preview.result!.balance, avgCost: preview.result!.avgCost };
}

// Códigos de Just que ya viven dentro de otro producto por un JUNTAR — la
// subida de Just los ignora para no volver a crear el duplicado.
export async function getMergedJustCodes(): Promise<Set<string>> {
  const rows = await prisma.catalogItemMerge.findMany({
    where: { kind: "MERGE", removedJustCode: { not: null } },
    select: { removedJustCode: true },
  });
  const codes = rows.map((r) => r.removedJustCode as string);
  if (codes.length === 0) return new Set();
  // Un código que el oficial heredó sigue vivo — ese sí se procesa normal.
  const stillLinked = await prisma.purchaseCatalogItem.findMany({ where: { justCode: { in: codes } }, select: { justCode: true } });
  const linked = new Set(stillLinked.map((i) => i.justCode));
  return new Set(codes.filter((c) => !linked.has(c)));
}

export async function getCatalogItemMergeHistory(limit = 50) {
  return prisma.catalogItemMerge.findMany({ orderBy: { performedAt: "desc" }, take: limit });
}
