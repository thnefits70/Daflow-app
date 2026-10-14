import { prisma } from "@/lib/prisma";

// Pedido del usuario 2026-10-13: mientras el conteo general (FULL) esté
// abierto, las compras se deciden con lo CONTADO, no con el Kardex viejo.
// - Producto contado: stock = Kardex de ahora + (contado − esperado). Es
//   exactamente lo que dejará el admin al aprobar la diferencia
//   (approveDifferences en stockCount.ts), así que se adelanta sin esperar
//   a que Daniel envíe ni a que el admin apruebe. Una diferencia ya aprobada
//   está en el Kardex y una rechazada no cuenta: en esos dos casos, 0.
// - Producto que estuvo en bodega y todavía no se contó: no se puede comprar
//   (ni pedir recompra) hasta que se cuente. Las emergencias y el admin no
//   pasan por este freno.
// Cuando el admin aprueba el conteo general todo vuelve al Kardex solo.

export type CountGate = {
  active: boolean;
  // catalogItemId → diferencia que falta aplicar al Kardex (0 si ya está).
  counted: Map<string, number>;
};

// Pedido de Daniel 2026-10-14 (caso Radio Baofeng 110339): un ajuste por
// conteo físico ya aplicado al Kardex ("Ajustar (conteo)" en Stock Actual)
// también es un conteo real: el número del sistema ya es lo que hay. Solo
// cuentan los hechos desde que empezó el conteo general.
// catalogItemId → cuándo se aplicó el último.
async function adjustmentsSince(since: Date, catalogItemIds?: string[]): Promise<Map<string, Date>> {
  const rows = await prisma.stockKardexEntry.findMany({
    where: { type: "PHYSICAL_COUNT_ADJUSTMENT", occurredAt: { gte: since }, ...(catalogItemIds ? { catalogItemId: { in: catalogItemIds } } : {}) },
    select: { catalogItemId: true, occurredAt: true },
    orderBy: { occurredAt: "asc" },
  });
  return new Map(rows.map((r) => [r.catalogItemId, r.occurredAt]));
}

async function openFullCount() {
  return prisma.stockCount.findFirst({ where: { kind: "FULL", status: { not: "APPROVED" } }, orderBy: { startedAt: "desc" }, select: { id: true, startedAt: true } });
}

export async function getCountGate(catalogItemIds?: string[]): Promise<CountGate> {
  const open = await openFullCount();
  if (!open) return { active: false, counted: new Map() };
  const [lines, adjusted] = await Promise.all([
    prisma.stockCountLine.findMany({
      where: { countId: open.id, ...(catalogItemIds ? { catalogItemId: { in: catalogItemIds } } : {}) },
      select: { catalogItemId: true, countedQty: true, expectedQty: true, decision: true, countedAt: true },
    }),
    adjustmentsSince(open.startedAt, catalogItemIds),
  ]);
  const counted = new Map<string, number>();
  for (const l of lines) {
    // Ajustado a mano después de contarlo: ese ajuste manda (se pone abajo).
    const adj = adjusted.get(l.catalogItemId);
    if (adj && adj > l.countedAt) continue;
    // En recuento (diferencia grande, 2026-10-13): todavía no se sabe, cuenta como no contado.
    if (l.decision === "RECOUNT") continue;
    counted.set(l.catalogItemId, l.decision === "APPROVED" || l.decision === "REJECTED" ? 0 : l.countedQty - l.expectedQty);
  }
  const lastCounted = new Map(lines.map((l) => [l.catalogItemId, l.countedAt]));
  for (const [id, at] of adjusted) {
    const last = lastCounted.get(id);
    // Ya está en el Kardex: no falta aplicar nada.
    if (!last || at > last) counted.set(id, 0);
  }
  return { active: true, counted };
}

// Stock para decidir compras: Kardex + lo contado que todavía no se aplicó.
export function countedBalance(gate: CountGate, catalogItemId: string, kardexBalance: number): number {
  return kardexBalance + (gate.counted.get(catalogItemId) ?? 0);
}

// true = estuvo en bodega (tiene Kardex) y falta contarlo en el conteo general.
export function isUncounted(gate: CountGate, catalogItemId: string, hasKardex: boolean): boolean {
  return gate.active && hasKardex && !gate.counted.has(catalogItemId);
}

export function uncountedMessage(name: string): string {
  return `"${name}" todavía no se cuenta en el conteo físico (o está en recuento por una diferencia grande), así que no se sabe cuánto hay de verdad. No se puede comprar hasta que se cuente: usa "Pedir que lo cuenten" (aquí mismo en Solicitar o en Qué comprar; le llega a Daniel). Si es una emergencia, va por la vía de emergencia.`;
}

// Para frenar solicitudes de compra y recompras. Los suministros (no se
// cuentan como mercadería) y los productos nuevos sin Kardex no se frenan.
export async function findUncountedItems(catalogItemIds: string[]): Promise<{ catalogItemId: string; name: string; message: string }[]> {
  const ids = [...new Set(catalogItemIds)];
  if (ids.length === 0) return [];
  const gate = await getCountGate(ids);
  if (!gate.active) return [];
  const pending = ids.filter((id) => !gate.counted.has(id));
  if (pending.length === 0) return [];
  const items = await prisma.purchaseCatalogItem.findMany({
    where: {
      id: { in: pending },
      stockKardexEntries: { some: {} },
      AND: [
        { OR: [{ bodega: null }, { bodega: { not: "MKT_SUMINISTROS" } }] },
        { OR: [{ justCode: null }, { NOT: { justCode: { contains: "-SUM-" } } }] },
      ],
    },
    select: { id: true, name: true },
  });
  return items.map((i) => ({ catalogItemId: i.id, name: i.name, message: uncountedMessage(i.name) }));
}

// Franja de Stock Actual (pedido de Daniel 2026-10-07 / usuario 2026-10-13),
// también en Qué comprar (pedido de Jariel 2026-10-14): verde = ya recontado,
// el número del sistema es el real (coincidió, el admin aprobó la diferencia o
// la dejó como está); amarillo = contado pero falta aplicarlo a INVESTOCK
// ("pending") o está en recuento por una diferencia grande ("recount").
export type CountMark = "real" | "pending" | "recount";

export function countMarksFromLines(
  lines: { catalogItemId: string; countedQty: number; expectedQty: number; decision: string | null; countedAt: Date }[],
  adjusted: Map<string, Date> = new Map(),
): Map<string, CountMark> {
  const real = new Set(lines.filter((l) => l.decision === "APPROVED" || l.decision === "REJECTED" || (l.decision === null && l.countedQty === l.expectedQty)).map((l) => l.catalogItemId));
  const marks = new Map<string, CountMark>();
  for (const l of lines) {
    if (l.decision === "RECOUNT") marks.set(l.catalogItemId, "recount");
    else if (l.decision === null && l.countedQty !== l.expectedQty) marks.set(l.catalogItemId, "pending");
    else marks.delete(l.catalogItemId);
  }
  for (const id of real) marks.set(id, "real");
  // Ajuste por conteo físico aplicado después del último conteo: verde.
  const lastCounted = new Map(lines.map((l) => [l.catalogItemId, l.countedAt]));
  for (const [id, at] of adjusted) {
    const last = lastCounted.get(id);
    if (!last || at > last) marks.set(id, "real");
  }
  return marks;
}

// Ajustes por conteo físico que pintan verde (desde que empezó el conteo general abierto).
export async function getCountAdjustments(catalogItemIds?: string[]): Promise<Map<string, Date>> {
  const open = await openFullCount();
  return open ? adjustmentsSince(open.startedAt, catalogItemIds) : new Map();
}

export async function getCountMarks(catalogItemIds?: string[]): Promise<Map<string, CountMark>> {
  const [lines, adjusted] = await Promise.all([
    prisma.stockCountLine.findMany({
      where: catalogItemIds ? { catalogItemId: { in: catalogItemIds } } : undefined,
      select: { catalogItemId: true, countedQty: true, expectedQty: true, decision: true, countedAt: true },
      orderBy: { countedAt: "asc" },
    }),
    getCountAdjustments(catalogItemIds),
  ]);
  return countMarksFromLines(lines, adjusted);
}
