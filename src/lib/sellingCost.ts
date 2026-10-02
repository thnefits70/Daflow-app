import { prisma } from "@/lib/prisma";
import { effectiveUnitCost } from "@/lib/purchases";

// Confirmado 2026-09-30, pedido del usuario: los PRECIOS DE VENTA (Dropi,
// B2B, B2C, Benistock, combos, ventas externas) ya no salen del costo
// promedio del Kardex, sino del costo de las unidades que QUEDAN de verdad en
// bodega. El Kardex (valor del inventario) no se toca — el contador dijo que
// eso se ve cuando todo el sistema esté funcionando.
//
// Cómo se sabe qué unidades quedan: se recorren las entradas y salidas del
// Kardex suponiendo que lo primero que entra es lo primero que sale. Cada
// compra deja un "grupo" de unidades con su costo (proveedor + flete).
//
// Regla (usuario):
// - Si el grupo más nuevo es el más caro → se usa su costo de inmediato.
// - Si la compra nueva salió más barata y quedan unidades caras → se usa el
//   promedio de lo que queda (baja un poco ya, para ganarle a la competencia).
//   Cuando se acaban las caras, el promedio baja solo al costo nuevo.
// - Freno: el precio nunca puede dejar en pérdida a la unidad más cara que
//   queda (con seguro y fulfillment, ganancia 0).
// Las llegadas que bodega ya registró pero Daniel todavía no aprobó (aún no
// están en el Kardex) también cuentan: la mercadería ya está en bodega.

// returned: unidades que volvieron a bodega (devolución/reingreso) — no son
// una compra, así que nunca cuentan como "la última compra".
// freight: la parte del costo que es flete (por unidad) — cost ya la incluye.
// Pedido del usuario 2026-10-02: para mostrar "Precio proveedor" sin flete y
// "Puesto en bodega" con flete por separado en Stock Actual.
type Layer = { qty: number; cost: number; returned?: boolean; freight?: number };

export type RemainingStockCost = {
  sellingCost: number;
  remainingUnits: number;
  averageRemaining: number;
  maxRemaining: number;
  newestCost: number;
  // Parte de sellingCost que es flete por unidad (0 si no se conoce).
  freightPerUnit: number;
};

// Costo mínimo que, con la fórmula del Precio Dropi, cubre el costo completo
// (con seguro y fulfillment) de la unidad más cara — el freno.
function breakEvenBasis(maxCost: number, insuranceRatePercent: number, fulfillmentCost: number, marginPercent: number) {
  const fullCost = maxCost * (1 + insuranceRatePercent / 100) + fulfillmentCost;
  return (fullCost * (1 - marginPercent / 100) - fulfillmentCost) / (1 + insuranceRatePercent / 100);
}

export function pickSellingCost(
  layers: Layer[],
  params: { insuranceRatePercent: number; fulfillmentCost: number; marginPercent: number }
): RemainingStockCost | null {
  const live = layers.filter((l) => l.qty > 0 && l.cost > 0);
  if (live.length === 0) {
    // Sin stock: el costo de la última compra (grupo con qty 0).
    const last = layers.filter((l) => l.cost > 0).at(-1);
    return last ? { sellingCost: last.cost, remainingUnits: 0, averageRemaining: last.cost, maxRemaining: last.cost, newestCost: last.cost, freightPerUnit: Math.min(last.freight ?? 0, last.cost) } : null;
  }
  const units = live.reduce((s, l) => s + l.qty, 0);
  const average = live.reduce((s, l) => s + l.qty * l.cost, 0) / units;
  const max = Math.max(...live.map((l) => l.cost));
  // Corregido 2026-10-02: una devolución que entra después de una compra
  // cara ya no tapa a esa compra — "la más nueva" es la última COMPRA.
  const newestLayer = live.filter((l) => !l.returned).at(-1) ?? live[live.length - 1];
  const newest = newestLayer.cost;
  const usesNewest = newest >= max;
  const sellingCost = usesNewest ? newest : Math.max(average, breakEvenBasis(max, params.insuranceRatePercent, params.fulfillmentCost, params.marginPercent));
  // El flete sigue al mismo criterio: el de la última compra si se usa esa,
  // si no el promedio del flete de lo que queda.
  const freight = usesNewest ? (newestLayer.freight ?? 0) : live.reduce((s, l) => s + l.qty * (l.freight ?? 0), 0) / units;
  return { sellingCost, remainingUnits: units, averageRemaining: average, maxRemaining: max, newestCost: newest, freightPerUnit: Math.min(freight, sellingCost) };
}

// Saca `qty` unidades de los grupos más antiguos y devuelve cuánto costaron
// en total las que sí había (para saber el costo real de una salida).
function consume(layers: Layer[], qty: number): { qty: number; total: number } {
  let left = qty;
  let total = 0;
  while (left > 0 && layers.length > 0) {
    const take = Math.min(left, layers[0].qty);
    total += take * layers[0].cost;
    layers[0].qty -= take;
    left -= take;
    if (layers[0].qty === 0) layers.shift();
  }
  return { qty: qty - left, total };
}

// Grupos de unidades que quedan por producto. Si la cuenta no cuadra con el
// saldo real del Kardex, se devuelve un solo grupo al costo promedio (no se
// inventa nada).
export async function getRemainingStockLayers(catalogItemIds: string[]): Promise<Map<string, Layer[]>> {
  return replayStockLayers(catalogItemIds);
}

// Pedido del usuario 2026-10-02 (reingreso por escaneo de guía): costo real
// por unidad de lo que salió en ciertas salidas del Kardex — se recorre el
// Kardex igual que para los precios (lo primero que entra es lo primero que
// sale) y se ve de qué compras salieron esas unidades. null si esas salidas
// no existen o no se pudo saber.
export async function costOfKardexOutEntries(catalogItemId: string, entryIds: string[]): Promise<number | null> {
  if (entryIds.length === 0) return null;
  const wanted = new Set(entryIds);
  let qty = 0;
  let total = 0;
  await replayStockLayers([catalogItemId], { includePending: false, onOut: (entryId, consumed) => {
    if (!wanted.has(entryId)) return;
    qty += consumed.qty;
    total += consumed.total;
  } });
  return qty > 0 && total > 0 ? total / qty : null;
}

async function replayStockLayers(
  catalogItemIds: string[],
  opts: { includePending?: boolean; onOut?: (entryId: string, consumed: { qty: number; total: number }) => void } = {}
): Promise<Map<string, Layer[]>> {
  const ids = [...new Set(catalogItemIds)];
  const result = new Map<string, Layer[]>();
  if (ids.length === 0) return result;

  const [entries, pendingReceipts] = await Promise.all([
    prisma.stockKardexEntry.findMany({
      where: { catalogItemId: { in: ids } },
      orderBy: [{ catalogItemId: "asc" }, { occurredAt: "asc" }, { createdAt: "asc" }],
      select: {
        id: true,
        catalogItemId: true,
        type: true,
        unitCost: true,
        balanceAfter: true,
        avgCostAfter: true,
        purchaseRequestReceipt: { select: { requestId: true, request: { select: { unitCost: true, quantity: true, shippingIncluded: true, shippingCostTotal: true } } } },
        priceCorrection: { select: { requestId: true, kardexAdjustedUnits: true } },
      },
    }),
    opts.includePending === false ? Promise.resolve([]) : prisma.purchaseRequestReceipt.findMany({
      where: { request: { catalogItemId: { in: ids }, status: "RECEIVED_PENDING_REVIEW" }, stockKardexEntry: null },
      orderBy: { confirmedAt: "asc" },
      select: { receivedQuantity: true, request: { select: { catalogItemId: true, unitCost: true, quantity: true, shippingIncluded: true, shippingCostTotal: true } } },
    }),
  ]);

  type TaggedLayer = Layer & { requestId?: string };
  let current: string | null = null;
  let layers: TaggedLayer[] = [];
  let balance = 0;
  let lastAvg = 0;
  let lastInCost = 0;
  let lastInFreight = 0;
  let lastInRequestId: string | undefined;
  const flush = () => {
    if (current === null) return;
    const sum = layers.reduce((s, l) => s + l.qty, 0);
    const list = sum === Math.max(balance, 0) ? layers.map(({ qty, cost, returned, freight }) => ({ qty, cost, returned, freight })) : balance > 0 ? [{ qty: balance, cost: lastAvg }] : [];
    result.set(current, list.length > 0 ? list : [{ qty: 0, cost: lastInCost || lastAvg, freight: lastInCost ? lastInFreight : 0 }]);
  };

  for (const e of entries) {
    if (e.catalogItemId !== current) {
      flush();
      current = e.catalogItemId;
      layers = [];
      balance = 0;
      lastInCost = 0;
      lastInFreight = 0;
      lastInRequestId = undefined;
    }
    const delta = e.balanceAfter - balance;
    if (e.type === "SEED" && balance === 0) {
      layers = [{ qty: e.balanceAfter, cost: e.unitCost ?? e.avgCostAfter }];
    } else if (e.type === "JUST_CUTOVER_SYNC" || e.type === "CUTOVER_CORRECTION") {
      // Punto de partida nuevo: el saldo y costo que quedaron.
      layers = e.balanceAfter > 0 ? [{ qty: e.balanceAfter, cost: e.avgCostAfter }] : [];
    } else if (e.type === "COST_DECLARATION") {
      for (const l of layers) {
        l.cost = e.unitCost ?? e.avgCostAfter;
        l.freight = 0;
      }
    } else if (e.type === "PRICE_CORRECTION") {
      // Corrige solo las unidades de esa compra que siguen en bodega.
      const diff = e.unitCost ?? 0;
      for (const l of layers) if (l.requestId && l.requestId === e.priceCorrection?.requestId) l.cost += diff;
      if (lastInRequestId && lastInRequestId === e.priceCorrection?.requestId) lastInCost += diff;
    } else if (delta > 0) {
      const req = e.purchaseRequestReceipt?.request;
      const freight = req ? Math.max(0, effectiveUnitCost(req) - req.unitCost) : 0;
      layers.push({ qty: delta, cost: e.unitCost ?? e.avgCostAfter, requestId: e.purchaseRequestReceipt?.requestId, returned: !e.purchaseRequestReceipt, freight });
      if (e.purchaseRequestReceipt && e.unitCost) {
        lastInCost = e.unitCost;
        lastInFreight = freight;
        lastInRequestId = e.purchaseRequestReceipt.requestId;
      }
    } else if (delta < 0) {
      const consumed = consume(layers, -delta);
      opts.onOut?.(e.id, consumed);
    }
    balance = e.balanceAfter;
    lastAvg = e.avgCostAfter;
  }
  flush();

  for (const r of pendingReceipts) {
    const list = (result.get(r.request.catalogItemId) ?? []).filter((l) => l.qty > 0);
    const cost = effectiveUnitCost(r.request);
    list.push({ qty: r.receivedQuantity, cost, freight: Math.max(0, cost - r.request.unitCost) });
    result.set(r.request.catalogItemId, list);
  }
  return result;
}
