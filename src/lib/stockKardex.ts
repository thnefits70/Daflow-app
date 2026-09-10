import { prisma } from "@/lib/prisma";
import { getInventoryLeadId } from "@/lib/guards";

// Fase 3 (INVESTOCK) — confirmado 2026-09-09: el número de stock propio de
// DAFLOW, construido como un Kardex real. Cada movimiento (entrada o
// salida) queda como su propia línea, con el saldo y el costo promedio
// ponderado justo después de esa línea — nunca solo un contador mutable —
// para poder ver exactamente por qué el número es el que es.

export async function getLatestKardexEntry(catalogItemId: string) {
  return prisma.stockKardexEntry.findFirst({
    where: { catalogItemId },
    orderBy: [{ occurredAt: "desc" }, { createdAt: "desc" }],
  });
}

export async function getCurrentStock(catalogItemId: string): Promise<{ balance: number; avgCost: number }> {
  const latest = await getLatestKardexEntry(catalogItemId);
  return { balance: latest?.balanceAfter ?? 0, avgCost: latest?.avgCostAfter ?? 0 };
}

// Confirmado 2026-09-09: costo promedio ponderado — una entrada IN mezcla
// su costo con lo que ya había; una entrada OUT nunca cambia el costo
// promedio (solo reduce el saldo), usa el promedio vigente como costo de
// esa salida específica (para poder valorizarla), congelado en el momento,
// nunca recalculado después.
export async function recordKardexEntry(params: {
  catalogItemId: string;
  type: "IN" | "OUT";
  quantity: number;
  unitCost: number | null;
  occurredAt: Date;
  purchaseRequestReceiptId?: string;
  merchandiseOutflowItemId?: string;
  // Confirmado 2026-09-10 (lotes de caducidad): solo aplica a entradas IN de
  // un producto que declara tener caducidad — crea el cohort y lo enlaza a
  // esta misma entrada, en la misma transacción.
  newExpirationLot?: { manufactureDate: Date | null; expirationDate: Date; quantity: number; declaredById: string | null };
}) {
  const current = await getCurrentStock(params.catalogItemId);

  let balanceAfter: number;
  let avgCostAfter: number;
  let unitCostForRow: number | null;

  if (params.type === "IN") {
    const incomingCost = params.unitCost ?? current.avgCost;
    const newBalance = current.balance + params.quantity;
    // Promedio ponderado: (saldo viejo × costo viejo + entrada × costo entrada) / saldo nuevo.
    // Si el saldo viejo era 0 o negativo (ej. venía de un error), el costo
    // nuevo pasa a ser directo el de esta entrada.
    avgCostAfter =
      newBalance > 0 && current.balance > 0
        ? (current.balance * current.avgCost + params.quantity * incomingCost) / newBalance
        : incomingCost;
    balanceAfter = newBalance;
    unitCostForRow = incomingCost;
  } else {
    balanceAfter = current.balance - params.quantity;
    avgCostAfter = current.avgCost; // una salida nunca cambia el costo promedio
    unitCostForRow = current.avgCost;
  }

  // Confirmado 2026-09-10 (lotes de caducidad, FEFO): en una salida de un
  // producto con caducidad, se reparte la cantidad entre los cohorts
  // activos empezando por el que vence primero. Si lo que se conoce en
  // cohorts no alcanza para cubrir toda la salida (stock viejo, de antes de
  // esta función), el resto queda sin asignar — nunca bloquea ni da error.
  const lotAllocations: { expirationCohortId: string; quantity: number }[] = [];
  if (params.type === "OUT") {
    const catalogItem = await prisma.purchaseCatalogItem.findUnique({
      where: { id: params.catalogItemId },
      select: { hasExpiration: true },
    });
    if (catalogItem?.hasExpiration) {
      const activeCohorts = await prisma.expirationCohort.findMany({
        where: { catalogItemId: params.catalogItemId, quantityRemaining: { gt: 0 } },
        orderBy: [{ expirationDate: "asc" }, { createdAt: "asc" }],
        select: { id: true, quantityRemaining: true },
      });
      let remaining = params.quantity;
      for (const cohort of activeCohorts) {
        if (remaining <= 0) break;
        const take = Math.min(cohort.quantityRemaining, remaining);
        lotAllocations.push({ expirationCohortId: cohort.id, quantity: take });
        remaining -= take;
      }
    }
  }

  return prisma.$transaction(async (tx) => {
    const entry = await tx.stockKardexEntry.create({
      data: {
        catalogItemId: params.catalogItemId,
        type: params.type,
        quantity: params.quantity,
        unitCost: unitCostForRow,
        balanceAfter,
        avgCostAfter,
        occurredAt: params.occurredAt,
        purchaseRequestReceiptId: params.purchaseRequestReceiptId,
        merchandiseOutflowItemId: params.merchandiseOutflowItemId,
      },
    });

    if (lotAllocations.length > 0) {
      await tx.stockKardexEntryLotAllocation.createMany({
        data: lotAllocations.map((a) => ({ kardexEntryId: entry.id, expirationCohortId: a.expirationCohortId, quantity: a.quantity })),
      });
      for (const a of lotAllocations) {
        await tx.expirationCohort.update({ where: { id: a.expirationCohortId }, data: { quantityRemaining: { decrement: a.quantity } } });
      }
    }

    if (params.type === "IN" && params.newExpirationLot) {
      const cohort = await tx.expirationCohort.create({
        data: {
          catalogItemId: params.catalogItemId,
          manufactureDate: params.newExpirationLot.manufactureDate,
          expirationDate: params.newExpirationLot.expirationDate,
          quantityReceived: params.newExpirationLot.quantity,
          quantityRemaining: params.newExpirationLot.quantity,
          declaredById: params.newExpirationLot.declaredById,
        },
      });
      await tx.stockKardexEntry.update({ where: { id: entry.id }, data: { sourceExpirationCohortId: cohort.id } });
    }

    return entry;
  });
}

// Confirmado 2026-09-10 (pedido de Daniel): declarar el lote de un producto
// que YA está en percha, sin depender de esperar la próxima compra — no
// toca el Kardex (esa mercadería ya está reflejada en el saldo), solo le
// pone fecha. Marca hasExpiration=true si no lo estaba, para que la próxima
// compra de este producto ya pida las fechas directo.
export async function declareExpirationLot(params: {
  catalogItemId: string;
  manufactureDate: Date | null;
  expirationDate: Date;
  quantity: number;
  declaredById: string | null;
}) {
  return prisma.$transaction(async (tx) => {
    const cohort = await tx.expirationCohort.create({
      data: {
        catalogItemId: params.catalogItemId,
        manufactureDate: params.manufactureDate,
        expirationDate: params.expirationDate,
        quantityReceived: params.quantity,
        quantityRemaining: params.quantity,
        declaredById: params.declaredById,
      },
    });
    await tx.purchaseCatalogItem.update({ where: { id: params.catalogItemId }, data: { hasExpiration: true } });
    return cohort;
  });
}

export type ExpirationLotRow = {
  id: string;
  manufactureDate: Date | null;
  expirationDate: Date;
  quantityReceived: number;
  quantityRemaining: number;
  declaredAt: Date;
};

export async function getActiveExpirationLots(catalogItemId: string): Promise<ExpirationLotRow[]> {
  return prisma.expirationCohort.findMany({
    where: { catalogItemId, quantityRemaining: { gt: 0 } },
    orderBy: [{ expirationDate: "asc" }, { createdAt: "asc" }],
    select: { id: true, manufactureDate: true, expirationDate: true, quantityReceived: true, quantityRemaining: true, declaredAt: true },
  });
}

export async function getAllExpirationLots(catalogItemId: string): Promise<ExpirationLotRow[]> {
  return prisma.expirationCohort.findMany({
    where: { catalogItemId },
    orderBy: [{ expirationDate: "asc" }, { createdAt: "asc" }],
    select: { id: true, manufactureDate: true, expirationDate: true, quantityReceived: true, quantityRemaining: true, declaredAt: true },
  });
}

export type ExpiringLot = {
  cohortId: string;
  catalogItemId: string;
  productName: string;
  expirationDate: Date;
  quantityRemaining: number;
};

// Confirmado 2026-09-10: bloque en KPIs financieros — red de seguridad para
// quien revise esa pantalla aunque se haya perdido el push (ver
// getExpiringLotPushes abajo).
export async function getExpiringLots(monthsAhead = 6): Promise<ExpiringLot[]> {
  const cutoff = new Date();
  cutoff.setMonth(cutoff.getMonth() + monthsAhead);
  const rows = await prisma.expirationCohort.findMany({
    where: { quantityRemaining: { gt: 0 }, expirationDate: { lte: cutoff } },
    orderBy: { expirationDate: "asc" },
    select: { id: true, catalogItemId: true, expirationDate: true, quantityRemaining: true, catalogItem: { select: { name: true } } },
  });
  return rows.map((r) => ({ cohortId: r.id, catalogItemId: r.catalogItemId, productName: r.catalogItem.name, expirationDate: r.expirationDate, quantityRemaining: r.quantityRemaining }));
}

export type ExpiringLotPush = { ownerId: string; title: string; body: string; url: string };

// Confirmado 2026-09-10: aviso proactivo por push al líder de Inventario —
// mismo patrón de guard de un solo disparo que deliveryOverdueAlertSentAt en
// externalSales.ts, nunca vuelve a avisar del mismo cohort una vez enviado.
export async function getExpiringLotPushes(monthsAhead = 6): Promise<ExpiringLotPush[]> {
  const leadId = await getInventoryLeadId();
  if (!leadId) return [];

  const cutoff = new Date();
  cutoff.setMonth(cutoff.getMonth() + monthsAhead);
  const rows = await prisma.expirationCohort.findMany({
    where: { quantityRemaining: { gt: 0 }, expirationDate: { lte: cutoff }, sixMonthAlertSentAt: null },
    orderBy: { expirationDate: "asc" },
    select: { id: true, expirationDate: true, quantityRemaining: true, catalogItem: { select: { name: true } } },
  });
  if (rows.length === 0) return [];

  await prisma.expirationCohort.updateMany({ where: { id: { in: rows.map((r) => r.id) } }, data: { sixMonthAlertSentAt: new Date() } });

  return rows.map((r) => {
    const dateLabel = r.expirationDate.toLocaleDateString("es-EC", { day: "2-digit", month: "short", year: "numeric" });
    return {
      ownerId: leadId,
      title: "⏰ Producto próximo a vencer",
      body: `${r.catalogItem.name} — ${r.quantityRemaining} un. vencen el ${dateLabel}.`,
      url: "/area/workspace?tab=reingreso",
    };
  });
}

export type StockAlertProduct = {
  catalogItemId: string;
  name: string;
  balance: number;
};

export type CurrentStockRow = {
  catalogItemId: string;
  name: string;
  justCode: string | null;
  balance: number;
  avgCost: number;
};

// Confirmado 2026-09-10 (pedido explícito del usuario): pantalla "Stock
// actual" — ver de un vistazo el saldo de INVESTOCK de TODOS los productos
// del catálogo, no solo los que ya se movieron. Un producto sin ninguna
// línea de Kardex todavía (nunca entró ni salió por este sistema) aparece
// con saldo 0, no se omite.
export async function getAllCurrentStock(): Promise<CurrentStockRow[]> {
  const [items, latestPerItem] = await Promise.all([
    prisma.purchaseCatalogItem.findMany({ select: { id: true, name: true, justCode: true }, orderBy: { name: "asc" } }),
    prisma.stockKardexEntry.findMany({
      distinct: ["catalogItemId"],
      orderBy: [{ catalogItemId: "asc" }, { occurredAt: "desc" }, { createdAt: "desc" }],
      select: { catalogItemId: true, balanceAfter: true, avgCostAfter: true },
    }),
  ]);
  const byItemId = new Map(latestPerItem.map((e) => [e.catalogItemId, e]));
  return items.map((i) => {
    const latest = byItemId.get(i.id);
    return {
      catalogItemId: i.id,
      name: i.name,
      justCode: i.justCode,
      balance: latest?.balanceAfter ?? 0,
      avgCost: latest?.avgCostAfter ?? 0,
    };
  });
}

export type SeedResult = { seededCount: number; skippedNoMatch: number; skippedAlreadyMoved: number };
type SnapshotRow = { productCode: string; avgCost: number; stock: number };

// Confirmado 2026-09-10 (pedido explícito del usuario): saldo inicial de
// INVESTOCK a partir del export de Just — solo toca productos que
// TODAVÍA NO TIENEN ningún movimiento propio (nunca se les llama de nuevo
// una vez que ya arrancaron, sea por este seed o por una compra/salida
// real), para nunca pisar un número que ya está corriendo de verdad. Es
// seguro llamarlo tantas veces como se suba el archivo — cada producto
// solo se siembra una vez, para siempre.
async function findSeedCandidates(rows: SnapshotRow[]) {
  const codes = [...new Set(rows.map((r) => r.productCode))];
  const items = await prisma.purchaseCatalogItem.findMany({
    where: { justCode: { in: codes } },
    select: { id: true, justCode: true },
  });
  const itemIdByCode = new Map(items.map((i) => [i.justCode as string, i.id]));
  const matchedIds = items.map((i) => i.id);
  const moved = await prisma.stockKardexEntry.findMany({
    where: { catalogItemId: { in: matchedIds } },
    distinct: ["catalogItemId"],
    select: { catalogItemId: true },
  });
  const movedSet = new Set(moved.map((m) => m.catalogItemId));

  const candidates: { catalogItemId: string; avgCost: number; stock: number }[] = [];
  let skippedNoMatch = 0;
  let skippedAlreadyMoved = 0;
  for (const r of rows) {
    const catalogItemId = itemIdByCode.get(r.productCode);
    if (!catalogItemId) { skippedNoMatch++; continue; }
    if (movedSet.has(catalogItemId)) { skippedAlreadyMoved++; continue; }
    candidates.push({ catalogItemId, avgCost: r.avgCost, stock: r.stock });
  }
  return { candidates, skippedNoMatch, skippedAlreadyMoved };
}

// Solo cuenta, no escribe — para que la pantalla sepa si mostrar el botón
// de "cargar saldo inicial" (y con qué número) sin sembrar nada todavía.
export async function countSeedableFromJustSnapshot(rows: SnapshotRow[]): Promise<number> {
  const { candidates } = await findSeedCandidates(rows);
  return candidates.length;
}

export async function seedFromJustSnapshot(rows: SnapshotRow[]): Promise<SeedResult> {
  const { candidates, skippedNoMatch, skippedAlreadyMoved } = await findSeedCandidates(rows);
  if (candidates.length > 0) {
    await prisma.stockKardexEntry.createMany({
      data: candidates.map((c) => ({
        catalogItemId: c.catalogItemId,
        type: "SEED" as const,
        quantity: c.stock,
        unitCost: c.avgCost,
        balanceAfter: c.stock,
        avgCostAfter: c.avgCost,
        occurredAt: new Date(),
      })),
    });
  }
  return { seededCount: candidates.length, skippedNoMatch, skippedAlreadyMoved };
}

// Confirmado 2026-09-09: alerta de stock negativo para la pantalla de KPIs
// financieros → Inventario — misma idea que ya se ve en el export de Just
// (4 SKUs negativos encontrados en el análisis inicial), pero calculada
// desde el Kardex propio en vez de depender de que alguien lo note en Excel.
export async function getNegativeStockProducts(): Promise<StockAlertProduct[]> {
  // Un producto puede tener muchas líneas — se necesita la ÚLTIMA de cada
  // uno. distinct + orderBy hace esto en una sola consulta.
  const latestPerItem = await prisma.stockKardexEntry.findMany({
    distinct: ["catalogItemId"],
    orderBy: [{ catalogItemId: "asc" }, { occurredAt: "desc" }, { createdAt: "desc" }],
    select: { catalogItemId: true, balanceAfter: true, catalogItem: { select: { name: true } } },
  });
  return latestPerItem
    .filter((e) => e.balanceAfter < 0)
    .map((e) => ({ catalogItemId: e.catalogItemId, name: e.catalogItem.name, balance: e.balanceAfter }));
}
