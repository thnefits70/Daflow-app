import { prisma } from "@/lib/prisma";
import { getFinanceLeadId } from "@/lib/guards";
import { sendPushToOwner } from "@/lib/webPush";

// Confirmado 2026-08-19: mismo patrón atómico que nextPurchaseRequestNumber
// — contador único en PlatformSettings, incrementado dentro de una
// transacción para que nunca se repita aunque dos colaboradores abran un
// lote al mismo tiempo.
export async function nextMerchandiseReentryNumber(): Promise<number> {
  const updated = await prisma.platformSettings.update({
    where: { id: "singleton" },
    data: { lastMerchandiseReentryNumber: { increment: 1 } },
  });
  return updated.lastMerchandiseReentryNumber;
}

export function formatMerchandiseReentryCode(batchNumber: number): string {
  return `RM-${String(batchNumber).padStart(4, "0")}`;
}

// Un item está "resuelto" para efectos de que Daniel pueda terminar de
// aprobar el lote cuando: (a) no necesitaba revisión manual (IA lo
// reconoció y no trae unidades dañadas) — se resuelve solo, de un clic en
// bloque — o (b) sí la necesitaba y ya se resolvió: tiene un nombre final
// (declarado o corregido) y, si tenía unidades dañadas, ya se decidió
// damageConfirmed (true o false, no null).
export function itemNeedsReview(item: { aiRecognized: boolean; damagedQty: number; correctedName: string | null; damageConfirmed: boolean | null }): boolean {
  const nameNeedsReview = !item.aiRecognized && !item.correctedName;
  const damageNeedsReview = item.damagedQty > 0 && item.damageConfirmed === null;
  return nameNeedsReview || damageNeedsReview;
}

// Nombre final a mostrarle a Daniel/Nairoby/Historial: la corrección de
// Daniel manda si existe, si no el nombre del catálogo (match de IA), si no
// el nombre puesto a mano por el colaborador.
export function itemDisplayName(item: { correctedName: string | null; catalogItem: { name: string } | null; declaredName: string | null }): string {
  return item.correctedName ?? item.catalogItem?.name ?? item.declaredName ?? "Producto sin nombre";
}

// Una vez que TODOS los items de un lote tienen approvedAt, el lote entero
// queda aprobado por Daniel — llamar después de cualquier acción que
// resuelva un item, para saber si hay que marcar danielApprovedAt. Avisa a
// Nairoby en el momento exacto en que el lote pasa a estar listo para ella,
// no en cada aprobación individual de item.
export async function maybeMarkBatchApproved(batchId: string) {
  const items = await prisma.merchandiseReentryItem.findMany({ where: { batchId }, select: { approvedAt: true } });
  if (items.length === 0 || items.some((i) => !i.approvedAt)) return;

  const batch = await prisma.merchandiseReentryBatch
    .update({ where: { id: batchId, danielApprovedAt: null }, data: { danielApprovedAt: new Date() } })
    .catch(() => null); // ya estaba marcado — no pasa nada
  if (!batch) return;

  const leadId = await getFinanceLeadId();
  if (leadId) {
    await sendPushToOwner(leadId, {
      title: "Reingreso de mercadería listo para cerrar",
      body: `${batch.code} — Daniel ya aprobó todo, listo para subir a Just o dar de baja.`,
      url: "/area/reingreso-mercaderia?tab=cierre",
    }).catch(() => null);
  }
}

export type MerchandiseReentryItemForGrouping = {
  id: string;
  batchId: string;
  createdAt: Date;
  goodQty: number;
  damagedQty: number;
  photoUrls: string[];
  correctedName: string | null;
  declaredName: string | null;
  catalogItem: { name: string } | null;
  damageReason: { name: string } | null;
  damageReasonOther: string | null;
  batch: { code: string };
};

// Nairoby ya no confirma item por item: productos con el mismo nombre final
// (misma lógica que itemDisplayName, sin importar de qué lote RM vengan) se
// agrupan en una sola tarjeta con la suma de unidades, para un solo clic en
// vez de repetir la acción por cada ocurrencia del mismo producto.
export function groupItemsForJustUpload(items: MerchandiseReentryItemForGrouping[]) {
  const groups = new Map<string, { name: string; totalGoodQty: number; earliestAt: Date; itemIds: string[]; breakdown: { id: string; batchCode: string; goodQty: number; createdAt: Date }[] }>();
  for (const item of items) {
    const name = itemDisplayName(item);
    const g = groups.get(name) ?? { name, totalGoodQty: 0, earliestAt: item.createdAt, itemIds: [], breakdown: [] };
    g.totalGoodQty += item.goodQty;
    if (item.createdAt < g.earliestAt) g.earliestAt = item.createdAt;
    g.itemIds.push(item.id);
    g.breakdown.push({ id: item.id, batchCode: item.batch.code, goodQty: item.goodQty, createdAt: item.createdAt });
    groups.set(name, g);
  }
  return [...groups.values()].sort((a, b) => a.earliestAt.getTime() - b.earliestAt.getTime());
}

export function groupItemsForWriteOff(items: MerchandiseReentryItemForGrouping[]) {
  const groups = new Map<
    string,
    { name: string; totalDamagedQty: number; earliestAt: Date; damageReasonLabel: string | null; photoUrl: string | null; itemIds: string[]; breakdown: { id: string; batchCode: string; damagedQty: number; createdAt: Date }[] }
  >();
  for (const item of items) {
    const name = itemDisplayName(item);
    const g = groups.get(name) ?? {
      name,
      totalDamagedQty: 0,
      earliestAt: item.createdAt,
      damageReasonLabel: item.damageReason?.name ?? item.damageReasonOther ?? null,
      photoUrl: item.photoUrls[0] ?? null,
      itemIds: [],
      breakdown: [],
    };
    g.totalDamagedQty += item.damagedQty;
    if (item.createdAt < g.earliestAt) g.earliestAt = item.createdAt;
    if (!g.photoUrl && item.photoUrls[0]) g.photoUrl = item.photoUrls[0];
    g.itemIds.push(item.id);
    g.breakdown.push({ id: item.id, batchCode: item.batch.code, damagedQty: item.damagedQty, createdAt: item.createdAt });
    groups.set(name, g);
  }
  return [...groups.values()].sort((a, b) => a.earliestAt.getTime() - b.earliestAt.getTime());
}

// Una vez que TODA parte relevante de TODOS los items de un lote está
// cerrada por Nairoby (buena subida a Just si goodQty>0, dañada dada de
// baja si quedó damageConfirmed=true), el lote entero se cierra.
export async function maybeMarkBatchClosed(batchId: string) {
  const items = await prisma.merchandiseReentryItem.findMany({
    where: { batchId },
    select: { goodQty: true, damagedQty: true, damageConfirmed: true, justUploadedAt: true, writeOffAt: true },
  });
  if (items.length === 0) return;
  const allClosed = items.every((i) => {
    const goodDone = i.goodQty <= 0 || !!i.justUploadedAt;
    const damagedDone = !(i.damagedQty > 0 && i.damageConfirmed === true) || !!i.writeOffAt;
    return goodDone && damagedDone;
  });
  if (!allClosed) return;
  await prisma.merchandiseReentryBatch.update({
    where: { id: batchId, closedAt: null },
    data: { closedAt: new Date() },
  }).catch(() => null);
}
