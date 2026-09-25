import { prisma } from "@/lib/prisma";

// Confirmado 2026-09-25: el Excel de Rocket se reemplazó por el PDF de
// etiquetas (ver dropiGuidesPdf + fulfillmentGuides, códigos "R…"). Acá
// quedan solo el detalle de una subida y su desglose de variantes.

export type VariantNote = { label: string; quantity: number };
export type CompiledFulfillmentLine = { catalogItemId: string; name: string; photos: string[]; justCode: string | null; quantity: number; variants: VariantNote[] };

export async function getCompiledBatch(batchId: string): Promise<{ id: string; source: string; requestedAt: Date; requestedByName: string; totalRows: number; skippedCount: number; lines: CompiledFulfillmentLine[] } | null> {
  const batch = await prisma.fulfillmentRequestBatch.findUnique({
    where: { id: batchId },
    include: {
      requestedBy: { select: { name: true } },
      items: { include: { catalogItem: { select: { id: true, name: true, photos: true, justCode: true } } } },
      variantNotes: { select: { catalogItemId: true, label: true, quantity: true } },
    },
  });
  if (!batch) return null;

  const byItem = new Map<string, CompiledFulfillmentLine>();
  for (const item of batch.items) {
    const existing = byItem.get(item.catalogItemId);
    if (existing) existing.quantity += item.quantity;
    else byItem.set(item.catalogItemId, { catalogItemId: item.catalogItemId, name: item.catalogItem.name, photos: item.catalogItem.photos, justCode: item.catalogItem.justCode, quantity: item.quantity, variants: [] });
  }
  for (const v of batch.variantNotes) {
    byItem.get(v.catalogItemId)?.variants.push({ label: v.label, quantity: v.quantity });
  }

  return {
    id: batch.id,
    source: batch.source,
    requestedAt: batch.requestedAt,
    requestedByName: batch.requestedBy?.name ?? "Administrador",
    totalRows: batch.totalRows,
    skippedCount: batch.skippedCount,
    lines: [...byItem.values()].sort((a, b) => b.quantity - a.quantity),
  };
}

export type SaveVariantsResult = { ok: true; variants: VariantNote[] } | { ok: false; error: string };

// Confirmado 2026-09-21: la versión digital de lo que Yair anotaba a mano en
// el papel — reemplaza TODO el desglose de ese producto en ese batch (no
// incremental), y se valida que la suma cuadre con el total real antes de
// guardar nada, a diferencia del papel donde nadie revisaba la suma.
export async function saveVariantNotes(batchId: string, catalogItemId: string, variants: VariantNote[], createdById: string | null): Promise<SaveVariantsResult> {
  const lot = await prisma.fulfillmentRequestBatch.findUnique({ where: { id: batchId }, select: { lot: { select: { status: true } } } });
  if (lot?.lot && lot.lot.status !== "DRAFT") return { ok: false, error: "Este corte ya se envió a Inventario — ya no se puede cambiar." };
  // Las garantías se marcan aparte (ver fulfillmentGuides) — no cuentan en el desglose de variantes.
  const items = await prisma.fulfillmentRequestItem.findMany({ where: { batchId, catalogItemId, warrantyGuide: null }, select: { quantity: true } });
  if (items.length === 0) return { ok: false, error: "Ese producto no está en este compendiado." };
  const total = items.reduce((sum, i) => sum + i.quantity, 0);

  const cleaned = variants.map((v) => ({ label: v.label.trim(), quantity: Math.round(v.quantity) })).filter((v) => v.label && v.quantity > 0);
  const sum = cleaned.reduce((s, v) => s + v.quantity, 0);
  if (cleaned.length > 0 && sum !== total) {
    return { ok: false, error: `Las variantes suman ${sum}, pero este producto necesita ${total} en total — ajusta las cantidades antes de guardar.` };
  }

  await prisma.$transaction([
    prisma.fulfillmentRequestVariantNote.deleteMany({ where: { batchId, catalogItemId } }),
    ...(cleaned.length > 0
      ? [prisma.fulfillmentRequestVariantNote.createMany({ data: cleaned.map((v) => ({ batchId, catalogItemId, label: v.label, quantity: v.quantity, createdById })) })]
      : []),
  ]);

  return { ok: true, variants: cleaned };
}
