import { prisma } from "@/lib/prisma";

// Confirmado 2026-08-31: umbral real que definió el usuario — 8 o más
// despachos en la semana = "funcionó". Debajo de eso, "todavía no funciona"
// (ver LowRotationWeeklyEntry, la lista semanal de Daniel).
export const LOW_ROTATION_THRESHOLD = 8;

// Cruza los productos ganadores más recientes de ATOM (status RENTABLE) con
// los productos de baja rotación más recientes de la lista de Daniel
// (unitsDispatched < 8), agrupados por PurchaseCatalogItem.nicho, y crea una
// ComboSuggestion (SUGERIDO) por cada pareja nueva. Sin IA — puro cruce de
// datos ya guardados. Nunca duplica: @@unique([winnerCatalogItemId,
// lowRotationCatalogItemId]) en el modelo evita crear la misma pareja dos
// veces aunque el cruce corra varias veces con datos frescos.
export async function generateComboSuggestions(): Promise<{ created: number }> {
  const [atomStatuses, lowRotationEntries, catalogItems] = await Promise.all([
    prisma.atomProductStatus.findMany({
      where: { status: "RENTABLE", isCombo: false, matchedCatalogItemId: { not: null } },
      orderBy: { capturedAt: "desc" },
      select: { matchedCatalogItemId: true, capturedAt: true },
    }),
    prisma.lowRotationWeeklyEntry.findMany({
      orderBy: { weekOf: "desc" },
      select: { catalogItemId: true, weekOf: true, unitsDispatched: true },
    }),
    prisma.purchaseCatalogItem.findMany({ where: { nicho: { not: null } }, select: { id: true, nicho: true } }),
  ]);

  // Solo la lectura más reciente de ATOM por producto decide si hoy es
  // ganador — un RENTABLE viejo no cuenta si luego bajó a SEGUIMIENTO.
  const latestAtomByItem = new Map<string, Date>();
  for (const s of atomStatuses) {
    const id = s.matchedCatalogItemId as string;
    if (!latestAtomByItem.has(id)) latestAtomByItem.set(id, s.capturedAt);
  }

  // Solo la semana más reciente de Daniel por producto decide si sigue de
  // baja rotación — si ya no aparece bajo el umbral la última vez, se saca
  // del cruce (aunque semanas anteriores sí lo tuvieran ahí).
  const latestWeekSeenByItem = new Map<string, Date>();
  const isLowRotationNow = new Map<string, boolean>();
  for (const e of lowRotationEntries) {
    const seen = latestWeekSeenByItem.get(e.catalogItemId);
    if (seen && seen.getTime() >= e.weekOf.getTime()) continue;
    latestWeekSeenByItem.set(e.catalogItemId, e.weekOf);
    isLowRotationNow.set(e.catalogItemId, e.unitsDispatched < LOW_ROTATION_THRESHOLD);
  }

  const nichoByItemId = new Map(catalogItems.map((i) => [i.id, i.nicho as string]));

  const winnerIdsByNicho = new Map<string, string[]>();
  for (const itemId of latestAtomByItem.keys()) {
    const nicho = nichoByItemId.get(itemId);
    if (!nicho) continue;
    winnerIdsByNicho.set(nicho, [...(winnerIdsByNicho.get(nicho) ?? []), itemId]);
  }

  const lowRotationIdsByNicho = new Map<string, string[]>();
  for (const [itemId, stillLow] of isLowRotationNow) {
    if (!stillLow) continue;
    const nicho = nichoByItemId.get(itemId);
    if (!nicho) continue;
    lowRotationIdsByNicho.set(nicho, [...(lowRotationIdsByNicho.get(nicho) ?? []), itemId]);
  }

  const pairs: { winnerCatalogItemId: string; lowRotationCatalogItemId: string; nicho: string }[] = [];
  for (const [nicho, winnerIds] of winnerIdsByNicho) {
    const lowIds = lowRotationIdsByNicho.get(nicho);
    if (!lowIds) continue;
    for (const winnerId of winnerIds) {
      for (const lowId of lowIds) {
        if (winnerId === lowId) continue;
        pairs.push({ winnerCatalogItemId: winnerId, lowRotationCatalogItemId: lowId, nicho });
      }
    }
  }
  if (pairs.length === 0) return { created: 0 };

  const existing = await prisma.comboSuggestion.findMany({
    where: { OR: pairs.map((p) => ({ winnerCatalogItemId: p.winnerCatalogItemId, lowRotationCatalogItemId: p.lowRotationCatalogItemId })) },
    select: { winnerCatalogItemId: true, lowRotationCatalogItemId: true },
  });
  const existingKeys = new Set(existing.map((e) => `${e.winnerCatalogItemId}::${e.lowRotationCatalogItemId}`));
  const newPairs = pairs.filter((p) => !existingKeys.has(`${p.winnerCatalogItemId}::${p.lowRotationCatalogItemId}`));
  if (newPairs.length === 0) return { created: 0 };

  const result = await prisma.comboSuggestion.createMany({
    data: newPairs.map((p) => ({ winnerCatalogItemId: p.winnerCatalogItemId, lowRotationCatalogItemId: p.lowRotationCatalogItemId, nicho: p.nicho })),
    skipDuplicates: true,
  });
  return { created: result.count };
}

// Cuántas semanas consecutivas lleva un producto en la lista de baja
// rotación de Daniel — usado como ranking simple en la pantalla de
// selección del equipo de MKT (mientras más semanas, más urgente moverlo).
export async function getLowRotationStreakWeeks(catalogItemId: string): Promise<number> {
  const entries = await prisma.lowRotationWeeklyEntry.findMany({
    where: { catalogItemId },
    orderBy: { weekOf: "desc" },
    select: { weekOf: true, unitsDispatched: true },
  });
  let streak = 0;
  for (const e of entries) {
    if (e.unitsDispatched >= LOW_ROTATION_THRESHOLD) break;
    streak++;
  }
  return streak;
}
