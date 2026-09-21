import { prisma } from "@/lib/prisma";
import { getInventoryLeadId } from "@/lib/guards";
import { effectiveUnitCost } from "@/lib/purchases";
import type { MarketProductBodega } from "@/generated/prisma/client";

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

export type KardexReleaseResult = { entriesPosted: number; catalogItemId: string };

// Confirmado 2026-09-18, pedido explícito del usuario: liberación final de
// Bryan para un producto nuevo (Análisis de Mercado) que se compró y recibió
// antes de que Heidy tuviera su ID de Dropi — ver awaitingDropiId en
// PurchaseCatalogItem. Le pone el justCode real al catálogo y recién ahí
// suma al Kardex, en orden real (por fecha de recepción, no la de hoy), cada
// compra que ya había llegado mientras se esperaba el ID — mismo criterio
// "insertar en la posición correcta de la línea de tiempo" que ya usan los
// backfills de arriba. Como el producto es nuevo, nunca hay líneas de Kardex
// previas que reordenar: cada receipt pendiente solo se agrega una vez, con
// su propio costo real, en el orden en que de verdad llegaron.
export async function releasePendingKardexForCatalogItem(catalogItemId: string, dropiProductId: string): Promise<KardexReleaseResult> {
  const justCodeTaken = await prisma.purchaseCatalogItem.findUnique({ where: { justCode: dropiProductId } });
  await prisma.purchaseCatalogItem.update({
    where: { id: catalogItemId },
    data: { awaitingDropiId: false, justCode: justCodeTaken && justCodeTaken.id !== catalogItemId ? null : dropiProductId },
  });

  const pendingRequests = await prisma.purchaseRequest.findMany({
    where: { catalogItemId, status: "RECEIVED", receipt: { approvedAt: { not: null }, stockKardexEntry: null } },
    include: { receipt: true },
    orderBy: { receipt: { approvedAt: "asc" } },
  });

  for (const request of pendingRequests) {
    if (!request.receipt?.approvedAt) continue;
    await recordKardexEntry({
      catalogItemId,
      type: "IN",
      quantity: request.receipt.receivedQuantity,
      unitCost: effectiveUnitCost({
        unitCost: request.unitCost,
        quantity: request.quantity,
        shippingIncluded: request.shippingIncluded,
        shippingCostTotal: request.shippingCostTotal,
      }),
      occurredAt: request.receipt.approvedAt,
      purchaseRequestReceiptId: request.receipt.id,
    });
  }

  return { entriesPosted: pendingRequests.length, catalogItemId };
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
  photos: string[];
  balance: number;
  avgCost: number;
  // Confirmado 2026-09-16, pedido explícito del usuario: marca/bodega
  // (Provedix/Importadora Damián/Importadora Shanghai) de este producto —
  // ver PurchaseCatalogItem.bodega en el schema.
  bodega: MarketProductBodega | null;
  // Confirmado 2026-09-21: true cuando el costo actual viene de
  // declareManualCost (admin lo escribió a mano, no de una compra real) —
  // para que Stock Actual lo marque distinto de un costo real de Kardex.
  costDeclaredManually: boolean;
};

// Confirmado 2026-09-10 (pedido explícito del usuario): pantalla "Stock
// actual" — ver de un vistazo el saldo de INVESTOCK de TODOS los productos
// del catálogo, no solo los que ya se movieron. Un producto sin ninguna
// línea de Kardex todavía (nunca entró ni salió por este sistema) aparece
// con saldo 0, no se omite.
// Confirmado 2026-09-17, pedido explícito del usuario: "Valor de inventario
// del mes" debe salir de INVESTOCK (Kardex real), no del archivo semanal de
// Just — Just queda solo de referencia, igual que en el resto de la app.
// INVESTOCK no guarda "fotos" mensuales — es un ledger corrido — así que el
// valor de un mes cerrado se reconstruye tomando, por cada producto, la
// última línea de Kardex con fecha dentro de ese mes o antes (el "saldo" que
// tenía justo al cierre). Un solo barrido ordenado por fecha (no una
// consulta por mes) para no repetir trabajo por cada uno de los 12 meses.
export async function getInvestockValueByMonthEnd(periods: string[]): Promise<Map<string, number>> {
  const cutoffs = periods
    .map((period) => {
      const [y, m] = period.split("-").map(Number);
      return { period, cutoff: new Date(Date.UTC(y, m, 0, 23, 59, 59, 999)) }; // último instante calendario de ese mes
    })
    .sort((a, b) => a.cutoff.getTime() - b.cutoff.getTime());

  const entries = await prisma.stockKardexEntry.findMany({
    orderBy: [{ occurredAt: "asc" }, { createdAt: "asc" }],
    select: { catalogItemId: true, occurredAt: true, balanceAfter: true, avgCostAfter: true },
  });

  const lastByItem = new Map<string, { balanceAfter: number; avgCostAfter: number }>();
  let idx = 0;
  const result = new Map<string, number>();
  for (const { period, cutoff } of cutoffs) {
    while (idx < entries.length && entries[idx].occurredAt <= cutoff) {
      lastByItem.set(entries[idx].catalogItemId, entries[idx]);
      idx++;
    }
    // Sin ningún movimiento todavía a esa fecha (mes anterior a que
    // existiera INVESTOCK) — null, no $0, para no confundir "sin datos" con
    // "inventario en cero".
    if (lastByItem.size === 0) continue;
    let total = 0;
    for (const v of lastByItem.values()) total += v.balanceAfter * v.avgCostAfter;
    result.set(period, total);
  }
  return result;
}

export async function getAllCurrentStock(): Promise<CurrentStockRow[]> {
  const [items, latestPerItem] = await Promise.all([
    prisma.purchaseCatalogItem.findMany({ select: { id: true, name: true, justCode: true, photos: true, bodega: true }, orderBy: { name: "asc" } }),
    prisma.stockKardexEntry.findMany({
      distinct: ["catalogItemId"],
      orderBy: [{ catalogItemId: "asc" }, { occurredAt: "desc" }, { createdAt: "desc" }],
      select: { catalogItemId: true, balanceAfter: true, avgCostAfter: true, type: true },
    }),
  ]);
  const byItemId = new Map(latestPerItem.map((e) => [e.catalogItemId, e]));
  return items.map((i) => {
    const latest = byItemId.get(i.id);
    return {
      catalogItemId: i.id,
      name: i.name,
      justCode: i.justCode,
      photos: i.photos,
      balance: latest?.balanceAfter ?? 0,
      avgCost: latest?.avgCostAfter ?? 0,
      bodega: i.bodega,
      costDeclaredManually: latest?.type === "COST_DECLARATION",
    };
  });
}

// Confirmado 2026-09-14: misma consulta que getAllCurrentStock, pero
// acotada a una lista de productos puntual — para no traer el catálogo
// completo (~500 filas) cada vez que se necesita el costo de un puñado de
// productos (ej. priceExternalSaleItems). Un id sin ninguna línea de
// Kardex todavía no aparece en el resultado (a diferencia de
// getAllCurrentStock, que sí lo lista con saldo 0) — quien llame debe
// tratar un id ausente como "sin costo".
export async function getCurrentStockByItemIds(catalogItemIds: string[]): Promise<Map<string, { balance: number; avgCost: number }>> {
  if (catalogItemIds.length === 0) return new Map();
  const latestPerItem = await prisma.stockKardexEntry.findMany({
    where: { catalogItemId: { in: catalogItemIds } },
    distinct: ["catalogItemId"],
    orderBy: [{ catalogItemId: "asc" }, { occurredAt: "desc" }, { createdAt: "desc" }],
    select: { catalogItemId: true, balanceAfter: true, avgCostAfter: true },
  });
  return new Map(latestPerItem.map((e) => [e.catalogItemId, { balance: e.balanceAfter, avgCost: e.avgCostAfter }]));
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

// Confirmado 2026-09-21, pedido explícito del usuario: desbloqueo rápido
// para un producto que YA tiene movimiento real en Kardex (por eso no
// califica para seedFromJustSnapshot, que solo toca productos sin ningún
// movimiento) pero cuyo costo promedio quedó en $0 porque nunca se le
// cargó la compra real — bloqueaba poder cotizarlo. El admin declara a
// mano el costo (normalmente el de Just/Daniel) SOLO mientras siga en $0;
// no se puede usar para pisar un costo real ya existente. Queda como su
// propia línea de Kardex (type=COST_DECLARATION, quantity=0 — no toca el
// saldo real) para que quede clara la diferencia con una compra real en
// cualquier auditoría futura. El día que entre la compra real de ese
// producto, el Kardex sigue corriendo normal desde ahí.
export async function declareManualCost(params: {
  catalogItemId: string;
  declaredCost: number;
  // null cuando lo declara el admin — su sesión no es un User real (ver
  // auth.ts, id sintético "admin"), mismo criterio que createdById en
  // stock-snapshot/save/route.ts.
  declaredById: string | null;
}): Promise<{ balanceAfter: number; avgCostAfter: number }> {
  if (params.declaredCost <= 0) {
    throw new Error("El costo declarado debe ser mayor a 0.");
  }
  const current = await getCurrentStock(params.catalogItemId);
  if (current.avgCost > 0) {
    throw new Error("Este producto ya tiene un costo real en INVESTOCK — no se puede reemplazar con un costo declarado a mano.");
  }
  const entry = await prisma.stockKardexEntry.create({
    data: {
      catalogItemId: params.catalogItemId,
      type: "COST_DECLARATION",
      quantity: 0,
      unitCost: params.declaredCost,
      balanceAfter: current.balance,
      avgCostAfter: params.declaredCost,
      declaredCostById: params.declaredById,
      occurredAt: new Date(),
    },
  });
  return { balanceAfter: entry.balanceAfter, avgCostAfter: entry.avgCostAfter };
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

// Confirmado 2026-09-16, pedido explícito del usuario (Camino A): corrección
// única, una sola vez, del historial de Kardex de ANTES de que
// approve-receipt/route.ts empezara a sumar el flete real (effectiveUnitCost)
// a cada compra nueva. Recorre el historial completo de cada producto, en
// orden, y rehace el promedio ponderado de punta a punta con el flete real
// donde aplique (un proveedor que nunca cobra flete aparte no cambia nada).
// Camino A confirmado con el usuario: una SALIDA (venta/despacho) nunca
// pierde su "costo con el que quedó valorada ese día" (unitCost) — solo se
// corrige avgCostAfter, que es el número que de verdad se usa en el resto de
// la app como "promedio vigente". Es seguro correr esto más de una vez:
// siempre recalcula desde cero a partir de datos reales que no cambian
// (PurchaseRequest.unitCost/shippingCostTotal), nunca acumula.
type KardexReplayUpdate = { id: string; unitCost: number | null; avgCostAfter: number; balanceAfter: number };

async function replayCatalogItemKardex(catalogItemId: string): Promise<{ updates: KardexReplayUpdate[]; oldAvgCost: number; newAvgCost: number } | null> {
  const entries = await prisma.stockKardexEntry.findMany({
    where: { catalogItemId },
    orderBy: [{ occurredAt: "asc" }, { createdAt: "asc" }],
    include: { purchaseRequestReceipt: { include: { request: true } } },
  });
  if (entries.length === 0) return null;

  const oldAvgCost = entries[entries.length - 1].avgCostAfter;
  let balance = 0;
  let avgCost = 0;
  const updates: KardexReplayUpdate[] = [];

  for (const e of entries) {
    if (e.type === "SEED") {
      // Saldo inicial importado de Just — no hay ninguna compra real detrás
      // que pueda tener flete que corregir, se deja tal cual.
      balance = e.quantity;
      avgCost = e.unitCost ?? 0;
      updates.push({ id: e.id, unitCost: e.unitCost, avgCostAfter: avgCost, balanceAfter: balance });
    } else if (e.type === "IN") {
      const request = e.purchaseRequestReceipt?.request ?? null;
      // Sin PurchaseRequest detrás (reingreso, devolución de venta, etc.):
      // no es una compra nueva, es mercadería que vuelve — reafirma el
      // promedio vigente, mismo comportamiento que ya tenía recordKardexEntry
      // con unitCost null.
      const incomingCost = request
        ? effectiveUnitCost({ unitCost: request.unitCost, quantity: request.quantity, shippingIncluded: request.shippingIncluded, shippingCostTotal: request.shippingCostTotal })
        : avgCost;
      const newBalance = balance + e.quantity;
      const newAvgCost = newBalance > 0 && balance > 0 ? (balance * avgCost + e.quantity * incomingCost) / newBalance : incomingCost;
      updates.push({ id: e.id, unitCost: incomingCost, avgCostAfter: newAvgCost, balanceAfter: newBalance });
      balance = newBalance;
      avgCost = newAvgCost;
    } else if (e.type === "COST_DECLARATION") {
      // Declaración manual de costo (ver declareManualCost) — quantity
      // siempre 0, no hay flete que corregir, solo se re-arrastra el costo
      // declarado para que el recómputo no lo borre.
      avgCost = e.unitCost ?? avgCost;
      updates.push({ id: e.id, unitCost: e.unitCost, avgCostAfter: avgCost, balanceAfter: balance });
    } else {
      // OUT — Camino A: unitCost (el costo con el que se valoró esa salida
      // el día que pasó) se deja exactamente como está, congelado.
      const newBalance = balance - e.quantity;
      updates.push({ id: e.id, unitCost: e.unitCost, avgCostAfter: avgCost, balanceAfter: newBalance });
      balance = newBalance;
    }
  }

  return { updates, oldAvgCost, newAvgCost: avgCost };
}

export type KardexFreightRecomputeRow = { catalogItemId: string; name: string; entriesChanged: number; oldAvgCost: number; newAvgCost: number };

// Solo lectura — no escribe nada. Para poder ver, antes de tocar la base
// real, qué productos cambiarían y por cuánto.
export async function previewKardexFreightRecompute(): Promise<KardexFreightRecomputeRow[]> {
  const items = await prisma.purchaseCatalogItem.findMany({ select: { id: true, name: true } });
  const rows: KardexFreightRecomputeRow[] = [];
  for (const item of items) {
    const result = await replayCatalogItemKardex(item.id);
    if (!result) continue;
    if (Math.abs(result.oldAvgCost - result.newAvgCost) > 0.0001) {
      rows.push({ catalogItemId: item.id, name: item.name, entriesChanged: result.updates.length, oldAvgCost: result.oldAvgCost, newAvgCost: result.newAvgCost });
    }
  }
  return rows;
}

export type KardexFreightRecomputeResult = { itemsChanged: number; entriesUpdated: number };

// La aplica de verdad — botón admin-only, un producto a la vez en su propia
// transacción (si uno falla, no se pierde lo ya corregido de los demás).
export async function applyKardexFreightRecompute(): Promise<KardexFreightRecomputeResult> {
  const items = await prisma.purchaseCatalogItem.findMany({ select: { id: true } });
  let itemsChanged = 0;
  let entriesUpdated = 0;
  for (const item of items) {
    const result = await replayCatalogItemKardex(item.id);
    if (!result || result.updates.length === 0) continue;
    if (Math.abs(result.oldAvgCost - result.newAvgCost) <= 0.0001) continue;
    await prisma.$transaction(
      result.updates.map((u) =>
        prisma.stockKardexEntry.update({
          where: { id: u.id },
          data: { unitCost: u.unitCost, avgCostAfter: u.avgCostAfter, balanceAfter: u.balanceAfter },
        })
      )
    );
    itemsChanged++;
    entriesUpdated += result.updates.length;
  }
  return { itemsChanged, entriesUpdated };
}

// Confirmado 2026-09-17, pedido explícito del usuario (admin): corrección
// única del bug real encontrado en merchandiseOutflow.ts — las Compras
// Personales nunca registraban su salida en el Kardex antes de esta fecha
// (ver createOutflowForPersonalPurchaseItem), así que su stock nunca se
// descontó de INVESTOCK. Este botón, exclusivo del admin, inserta las
// salidas que faltan en la posición correcta de la línea de tiempo de cada
// producto (por su fecha real, no la de hoy) y rehace el saldo/promedio de
// ese producto de punta a punta — mismo criterio "Camino A" que el
// recómputo de flete: una salida YA EXISTENTE nunca pierde el costo con el
// que quedó valorada ese día, solo se insertan las que faltan y se
// recalculan los saldos. Idempotente de verdad: una vez insertada, esa
// misma compra ya no vuelve a aparecer como "faltante" — seguro de correr
// tantas veces como haga falta.
export type PersonalPurchaseBackfillCandidate = {
  merchandiseOutflowItemId: string;
  catalogItemId: string;
  quantity: number;
  occurredAt: Date;
};

async function findMissingPersonalPurchaseKardexEntries(): Promise<PersonalPurchaseBackfillCandidate[]> {
  const items = await prisma.merchandiseOutflowItem.findMany({
    where: { batch: { reason: "COMPRA_PERSONAL", submittedAt: { not: null } }, catalogItemId: { not: null } },
    select: { id: true, catalogItemId: true, quantity: true, batch: { select: { submittedAt: true } } },
  });
  if (items.length === 0) return [];
  const existing = await prisma.stockKardexEntry.findMany({
    where: { merchandiseOutflowItemId: { in: items.map((i) => i.id) } },
    select: { merchandiseOutflowItemId: true },
  });
  const done = new Set(existing.map((e) => e.merchandiseOutflowItemId));
  return items
    .filter((i) => i.catalogItemId && !done.has(i.id))
    .map((i) => ({ merchandiseOutflowItemId: i.id, catalogItemId: i.catalogItemId!, quantity: i.quantity, occurredAt: i.batch.submittedAt! }));
}

type BackfillLine =
  | { kind: "existing"; id: string; type: "IN" | "OUT" | "SEED" | "COST_DECLARATION"; quantity: number; unitCost: number | null; occurredAt: Date; createdAt: Date }
  | { kind: "new"; merchandiseOutflowItemId: string; quantity: number; occurredAt: Date };

async function replayCatalogItemWithBackfill(catalogItemId: string, missing: PersonalPurchaseBackfillCandidate[]) {
  const existingEntries = await prisma.stockKardexEntry.findMany({ where: { catalogItemId }, orderBy: [{ occurredAt: "asc" }, { createdAt: "asc" }] });
  const oldAvgCost = existingEntries.length > 0 ? existingEntries[existingEntries.length - 1].avgCostAfter : 0;
  const oldBalance = existingEntries.length > 0 ? existingEntries[existingEntries.length - 1].balanceAfter : 0;

  const lines: BackfillLine[] = [
    ...existingEntries.map((e): BackfillLine => ({ kind: "existing", id: e.id, type: e.type, quantity: e.quantity, unitCost: e.unitCost, occurredAt: e.occurredAt, createdAt: e.createdAt })),
    ...missing.map((m): BackfillLine => ({ kind: "new", merchandiseOutflowItemId: m.merchandiseOutflowItemId, quantity: m.quantity, occurredAt: m.occurredAt })),
  ];
  // Orden real por fecha del movimiento — a igualdad de fecha, lo ya
  // existente va antes que lo insertado (createdAt real vs. "ahora mismo").
  lines.sort((a, b) => a.occurredAt.getTime() - b.occurredAt.getTime() || (a.kind === "existing" ? a.createdAt.getTime() : Infinity) - (b.kind === "existing" ? b.createdAt.getTime() : Infinity));

  let balance = 0;
  let avgCost = 0;
  const updates: KardexReplayUpdate[] = [];
  const inserts: { merchandiseOutflowItemId: string; occurredAt: Date; quantity: number; unitCost: number; balanceAfter: number; avgCostAfter: number }[] = [];

  for (const line of lines) {
    if (line.kind === "new") {
      // Una compra personal es siempre una salida — nunca cambia el
      // promedio, se valora al costo vigente en ese momento.
      const newBalance = balance - line.quantity;
      inserts.push({ merchandiseOutflowItemId: line.merchandiseOutflowItemId, occurredAt: line.occurredAt, quantity: line.quantity, unitCost: avgCost, balanceAfter: newBalance, avgCostAfter: avgCost });
      balance = newBalance;
      continue;
    }
    if (line.type === "SEED") {
      balance = line.quantity;
      avgCost = line.unitCost ?? 0;
      updates.push({ id: line.id, unitCost: line.unitCost, avgCostAfter: avgCost, balanceAfter: balance });
    } else if (line.type === "IN") {
      const incomingCost = line.unitCost ?? avgCost;
      const newBalance = balance + line.quantity;
      avgCost = newBalance > 0 && balance > 0 ? (balance * avgCost + line.quantity * incomingCost) / newBalance : incomingCost;
      updates.push({ id: line.id, unitCost: line.unitCost, avgCostAfter: avgCost, balanceAfter: newBalance });
      balance = newBalance;
    } else if (line.type === "COST_DECLARATION") {
      // Declaración manual de costo (ver declareManualCost) — quantity
      // siempre 0, nunca mueve el saldo, solo fija el costo promedio desde
      // ese punto en adelante.
      avgCost = line.unitCost ?? avgCost;
      updates.push({ id: line.id, unitCost: line.unitCost, avgCostAfter: avgCost, balanceAfter: balance });
    } else {
      // OUT ya existente — Camino A: su unitCost (valoración congelada el
      // día que pasó) nunca se toca, solo el saldo que arrastra.
      const newBalance = balance - line.quantity;
      updates.push({ id: line.id, unitCost: line.unitCost, avgCostAfter: avgCost, balanceAfter: newBalance });
      balance = newBalance;
    }
  }

  return { updates, inserts, oldAvgCost, oldBalance, newAvgCost: avgCost, newBalance: balance };
}

export type PersonalPurchaseBackfillPreviewRow = { catalogItemId: string; name: string; missingCount: number; missingUnits: number; oldBalance: number; newBalance: number };

export async function previewPersonalPurchaseKardexBackfill(): Promise<PersonalPurchaseBackfillPreviewRow[]> {
  const missing = await findMissingPersonalPurchaseKardexEntries();
  if (missing.length === 0) return [];
  const byCatalogItemId = new Map<string, PersonalPurchaseBackfillCandidate[]>();
  for (const m of missing) {
    const arr = byCatalogItemId.get(m.catalogItemId) ?? [];
    arr.push(m);
    byCatalogItemId.set(m.catalogItemId, arr);
  }
  const items = await prisma.purchaseCatalogItem.findMany({ where: { id: { in: [...byCatalogItemId.keys()] } }, select: { id: true, name: true } });
  const nameById = new Map(items.map((i) => [i.id, i.name]));

  const rows: PersonalPurchaseBackfillPreviewRow[] = [];
  for (const [catalogItemId, missingForItem] of byCatalogItemId) {
    const result = await replayCatalogItemWithBackfill(catalogItemId, missingForItem);
    rows.push({
      catalogItemId,
      name: nameById.get(catalogItemId) ?? "Producto",
      missingCount: missingForItem.length,
      missingUnits: missingForItem.reduce((s, m) => s + m.quantity, 0),
      oldBalance: result.oldBalance,
      newBalance: result.newBalance,
    });
  }
  return rows.sort((a, b) => b.missingUnits - a.missingUnits);
}

export type PersonalPurchaseBackfillResult = { itemsChanged: number; entriesInserted: number };

export async function applyPersonalPurchaseKardexBackfill(): Promise<PersonalPurchaseBackfillResult> {
  const missing = await findMissingPersonalPurchaseKardexEntries();
  if (missing.length === 0) return { itemsChanged: 0, entriesInserted: 0 };
  const byCatalogItemId = new Map<string, PersonalPurchaseBackfillCandidate[]>();
  for (const m of missing) {
    const arr = byCatalogItemId.get(m.catalogItemId) ?? [];
    arr.push(m);
    byCatalogItemId.set(m.catalogItemId, arr);
  }

  let itemsChanged = 0;
  let entriesInserted = 0;
  for (const [catalogItemId, missingForItem] of byCatalogItemId) {
    const result = await replayCatalogItemWithBackfill(catalogItemId, missingForItem);
    await prisma.$transaction([
      ...result.updates.map((u) =>
        prisma.stockKardexEntry.update({ where: { id: u.id }, data: { unitCost: u.unitCost, avgCostAfter: u.avgCostAfter, balanceAfter: u.balanceAfter } })
      ),
      ...result.inserts.map((ins) =>
        prisma.stockKardexEntry.create({
          data: {
            catalogItemId,
            type: "OUT",
            quantity: ins.quantity,
            unitCost: ins.unitCost,
            balanceAfter: ins.balanceAfter,
            avgCostAfter: ins.avgCostAfter,
            occurredAt: ins.occurredAt,
            merchandiseOutflowItemId: ins.merchandiseOutflowItemId,
          },
        })
      ),
    ]);
    itemsChanged++;
    entriesInserted += result.inserts.length;
  }
  return { itemsChanged, entriesInserted };
}
