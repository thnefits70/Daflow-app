import { prisma } from "@/lib/prisma";

// Confirmado 2026-08-31: umbral real que definió el usuario — 8 o más
// despachos en la semana = "funcionó". Debajo de eso, "todavía no funciona"
// (ver LowRotationWeeklyEntry, la lista semanal de Daniel).
export const LOW_ROTATION_THRESHOLD = 8;

const WEEKLY_SNAPSHOT_PERIOD_RE = /^\d{4}-\d{2}-W[1-4]$/;

// Confirmado 2026-09-03 (pedido explícito del usuario, aclarado por Daniel):
// el Excel semanal de "Productos sin movimiento — stock por SKU" (Control de
// Inventario, InventoryProductSnapshot) usa el MISMO código que Just —
// verificado contra un archivo real: sus 55 códigos y nombres coinciden 1 a
// 1 con PurchaseCatalogItem.justCode. Daniel ya sube ese archivo cada semana
// para esa otra pantalla — nunca hizo falta pedirle que además llene "Baja
// rotación semanal" a mano: "unidades movidas esta semana" se puede
// aproximar como (stock de la semana pasada − stock de esta semana), y
// aplicar el mismo umbral de 8. Esto SUMA candidatos de baja rotación al
// cruce, además de (no en vez de) lo que alguien cargue a mano en
// LowRotationWeeklyEntry — ninguna de las dos fuentes es obligatoria.
async function getAutoLowRotationFromStockSnapshots(): Promise<{ catalogItemId: string; unitsMoved: number }[]> {
  const periodRows = await prisma.inventoryProductSnapshot.findMany({ select: { period: true }, distinct: ["period"] });
  const allPeriods = periodRows.map((r) => r.period);
  const weeklyPeriods = allPeriods.filter((p) => WEEKLY_SNAPSHOT_PERIOD_RE.test(p)).sort();

  let prevPeriod: string;
  let curPeriod: string;
  if (weeklyPeriods.length >= 2) {
    [prevPeriod, curPeriod] = weeklyPeriods.slice(-2);
  } else if (weeklyPeriods.length === 1) {
    // Primera semana real del proceso semanal (confirmado 2026-09-03) —
    // todavía no hay una semana anterior con qué comparar, así que se usa el
    // último snapshot MENSUAL (formato "YYYY-MM", el proceso de antes de
    // pasar a semanal) como base aproximada, solo para esta primera vez.
    const monthlyPeriods = allPeriods.filter((p) => /^\d{4}-\d{2}$/.test(p)).sort();
    if (monthlyPeriods.length === 0) return [];
    prevPeriod = monthlyPeriods[monthlyPeriods.length - 1];
    curPeriod = weeklyPeriods[0];
  } else {
    return []; // todavía no hay ningún snapshot semanal cargado
  }
  const [prevRows, curRows, catalogItems] = await Promise.all([
    prisma.inventoryProductSnapshot.findMany({ where: { period: prevPeriod }, select: { productCode: true, stock: true } }),
    prisma.inventoryProductSnapshot.findMany({ where: { period: curPeriod }, select: { productCode: true, stock: true } }),
    prisma.purchaseCatalogItem.findMany({ where: { justCode: { not: null } }, select: { id: true, justCode: true } }),
  ]);

  const prevStockByCode = new Map(prevRows.map((r) => [r.productCode, r.stock]));
  const catalogIdByJustCode = new Map(catalogItems.map((c) => [c.justCode as string, c.id]));

  const out: { catalogItemId: string; unitsMoved: number }[] = [];
  for (const row of curRows) {
    const catalogItemId = catalogIdByJustCode.get(row.productCode);
    if (!catalogItemId) continue; // producto del reporte de Finanzas que no está (o no tiene justCode) en Base de datos de productos
    const prevStock = prevStockByCode.get(row.productCode);
    if (prevStock === undefined) continue; // primera semana de este producto — nada con qué comparar
    const unitsMoved = Math.max(0, prevStock - row.stock); // un aumento de stock (reposición) nunca cuenta como "vendido"
    out.push({ catalogItemId, unitsMoved });
  }
  return out;
}

// Cruza los productos ganadores más recientes de ATOM (status RENTABLE) con
// los productos de baja rotación más recientes — de la lista manual de
// Daniel (unitsDispatched < 8) Y del cruce automático contra el Excel
// semanal de stock (ver arriba) — agrupados por PurchaseCatalogItem.nicho, y
// crea una ComboSuggestion (SUGERIDO) por cada pareja nueva. Sin IA — puro
// cruce de datos ya guardados. Nunca duplica: @@unique([winnerCatalogItemId,
// lowRotationCatalogItemId]) en el modelo evita crear la misma pareja dos
// veces aunque el cruce corra varias veces con datos frescos.
export async function generateComboSuggestions(): Promise<{ created: number }> {
  const [atomStatuses, lowRotationEntries, catalogItems, autoLowRotation] = await Promise.all([
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
    getAutoLowRotationFromStockSnapshots(),
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

  // El cruce automático SUMA candidatos — nunca apaga uno que la lista
  // manual de Daniel ya haya marcado explícitamente como "ya no" (ver
  // comentario en getAutoLowRotationFromStockSnapshots).
  for (const a of autoLowRotation) {
    if (isLowRotationNow.has(a.catalogItemId)) continue;
    if (a.unitsMoved < LOW_ROTATION_THRESHOLD) isLowRotationNow.set(a.catalogItemId, true);
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
