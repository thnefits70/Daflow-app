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
// - Freno: el precio nunca puede dejar a la unidad más cara que queda con
//   menos de BRAKE_MIN_MARGIN_PERCENT de ganancia (con seguro y fulfillment).
//   Cambiado 2026-10-02, pedido del usuario: antes era ganancia 0, ahora 10%
//   hasta que se acaben esas unidades caras.
// Las llegadas que bodega ya registró pero Daniel todavía no aprobó (aún no
// están en el Kardex) también cuentan: la mercadería ya está en bodega.

// returned: unidades que volvieron a bodega (devolución/reingreso) — no son
// una compra, así que nunca cuentan como "la última compra".
// freight: la parte del costo que es flete (por unidad) — cost ya la incluye.
// Pedido del usuario 2026-10-02: para mostrar "Precio proveedor" sin flete y
// "Puesto en bodega" con flete por separado en Stock Actual.
// unknownCost: unidades que entraron sin costo conocido (devoluciones antes de
// la primera compra) — toman el costo de la siguiente compra real.
type Layer = { qty: number; cost: number; returned?: boolean; freight?: number; unknownCost?: boolean };

export type RemainingStockCost = {
  sellingCost: number;
  remainingUnits: number;
  averageRemaining: number;
  maxRemaining: number;
  newestCost: number;
  // Parte de sellingCost que es flete por unidad (0 si no se conoce).
  freightPerUnit: number;
};

const BRAKE_MIN_MARGIN_PERCENT = 10;

// Costo mínimo que, con la fórmula del Precio Dropi, deja a la unidad más
// cara con al menos BRAKE_MIN_MARGIN_PERCENT de ganancia (con seguro y
// fulfillment) — el freno. Si el margen del producto es menor que 10%, el
// freno usa ese margen (nunca pide más ganancia que el propio producto).
function breakEvenBasis(maxCost: number, insuranceRatePercent: number, fulfillmentCost: number, marginPercent: number) {
  const fullCost = maxCost * (1 + insuranceRatePercent / 100) + fulfillmentCost;
  const minPrice = fullCost / (1 - Math.min(BRAKE_MIN_MARGIN_PERCENT, marginPercent) / 100);
  return (minPrice * (1 - marginPercent / 100) - fulfillmentCost) / (1 + insuranceRatePercent / 100);
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
  // Con tolerancia: diferencias de redondeo (0.0000000001) no cuentan como "más caro".
  const usesNewest = newest >= max - 1e-6;
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
  opts: {
    includePending?: boolean;
    onOut?: (entryId: string, consumed: { qty: number; total: number }) => void;
    onItemDone?: (catalogItemId: string, info: { balance: number; kardexAvg: number; cleanAvg: number }) => void;
  } = {}
): Promise<Map<string, Layer[]>> {
  const ids = [...new Set(catalogItemIds)];
  const result = new Map<string, Layer[]>();
  if (ids.length === 0) return result;

  const [entries, pendingReceipts] = await Promise.all([
    prisma.stockKardexEntry.findMany({
      where: { catalogItemId: { in: ids } },
      // id al final: algunas cargas iniciales tienen la misma hora exacta y
      // sin desempate el orden (y el costo) cambiaba de una consulta a otra.
      orderBy: [{ catalogItemId: "asc" }, { occurredAt: "asc" }, { createdAt: "asc" }, { id: "asc" }],
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
  // Pedido del usuario 2026-10-02: el Kardex cuenta como $0 las unidades que
  // entraron sin costo (devoluciones antes de la primera compra) y eso baja
  // su promedio (ej. Bolso Antirobo: 7 a $0 + 200 a $3.25 = $3.14). El
  // Kardex NO se toca (contador); solo para los precios se lleva acá el
  // mismo promedio pero sin contar esas unidades como $0. Las devoluciones
  // que entraron al promedio del Kardex y los cortes con Just usan este.
  let cleanAvg = 0;
  let prevKardexAvg = 0;
  // CUTOVER_CORRECTION devuelve el saldo/costo de justo antes del corte con
  // Just: se guarda el promedio limpio de ese momento para devolver ese.
  let beforeCutover: { kardexAvg: number; cleanAvg: number } | null = null;
  const flush = () => {
    if (current === null) return;
    opts.onItemDone?.(current, { balance, kardexAvg: lastAvg, cleanAvg });
    const sum = layers.reduce((s, l) => s + l.qty, 0);
    const list = sum === Math.max(balance, 0) ? layers.map(({ qty, cost, returned, freight, unknownCost }) => ({ qty, cost, returned, freight, unknownCost })) : balance > 0 ? [{ qty: balance, cost: cleanAvg || lastAvg }] : [];
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
      cleanAvg = 0;
      prevKardexAvg = 0;
      beforeCutover = null;
    }
    const delta = e.balanceAfter - balance;
    if (e.type === "SEED" && balance === 0) {
      const cost = e.unitCost ?? e.avgCostAfter;
      layers = [{ qty: e.balanceAfter, cost, unknownCost: cost <= 0 }];
      cleanAvg = cost;
    } else if (e.type === "JUST_CUTOVER_SYNC" || e.type === "CUTOVER_CORRECTION") {
      // Punto de partida nuevo: el saldo y costo que quedaron. Si el corte
      // no cambió el promedio, se usa el promedio sin unidades a $0.
      if (e.type === "JUST_CUTOVER_SYNC" && !beforeCutover) beforeCutover = { kardexAvg: prevKardexAvg, cleanAvg };
      const restoresBefore = e.type === "CUTOVER_CORRECTION" && beforeCutover && beforeCutover.cleanAvg > 0 && Math.abs(e.avgCostAfter - beforeCutover.kardexAvg) < 1e-9;
      const cost = restoresBefore ? beforeCutover!.cleanAvg : cleanAvg > 0 && Math.abs(e.avgCostAfter - prevKardexAvg) < 1e-9 ? cleanAvg : e.avgCostAfter;
      layers = e.balanceAfter > 0 ? [{ qty: e.balanceAfter, cost, unknownCost: cost <= 0 }] : [];
      cleanAvg = cost;
    } else if (e.type === "COST_DECLARATION") {
      // avgCostAfter (lo que el Kardex usó de verdad): en un caso (Corrector de
      // postura) la línea dice $1.25 pero el Kardex siguió con $2.78.
      for (const l of layers) {
        l.cost = e.avgCostAfter;
        l.freight = 0;
        l.unknownCost = l.cost <= 0;
      }
      cleanAvg = e.avgCostAfter;
    } else if (e.type === "PRICE_CORRECTION") {
      // Corrige solo las unidades de esa compra que siguen en bodega.
      const diff = e.unitCost ?? 0;
      for (const l of layers) if (l.requestId && l.requestId === e.priceCorrection?.requestId) l.cost += diff;
      if (lastInRequestId && lastInRequestId === e.priceCorrection?.requestId) lastInCost += diff;
      cleanAvg += e.avgCostAfter - prevKardexAvg;
    } else if (delta > 0) {
      const req = e.purchaseRequestReceipt?.request;
      const freight = req ? Math.max(0, effectiveUnitCost(req) - req.unitCost) : 0;
      const isPurchase = !!e.purchaseRequestReceipt;
      // Una devolución sin costo propio entra al promedio del Kardex de ese
      // momento — acá se le pone el promedio sin unidades a $0 (0 = aún no
      // se sabe, lo llena la siguiente compra).
      const tookAverage = !isPurchase && (!e.unitCost || Math.abs(e.unitCost - prevKardexAvg) < 1e-9);
      const cost = tookAverage ? cleanAvg : (e.unitCost ?? e.avgCostAfter);
      if (isPurchase && cost > 0) {
        for (const l of layers) {
          if (!l.unknownCost) continue;
          l.cost = cost;
          l.freight = freight;
          l.unknownCost = false;
        }
      }
      if (cost > 0) cleanAvg = cleanAvg > 0 && balance > 0 ? (balance * cleanAvg + delta * cost) / (balance + delta) : cost;
      layers.push({ qty: delta, cost, requestId: e.purchaseRequestReceipt?.requestId, returned: !isPurchase, freight, unknownCost: cost <= 0 });
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
    prevKardexAvg = e.avgCostAfter;
  }
  flush();

  for (const r of pendingReceipts) {
    const list = (result.get(r.request.catalogItemId) ?? []).filter((l) => l.qty > 0);
    const cost = effectiveUnitCost(r.request);
    const freight = Math.max(0, cost - r.request.unitCost);
    if (cost > 0) {
      for (const l of list) {
        if (!l.unknownCost) continue;
        l.cost = cost;
        l.freight = freight;
        l.unknownCost = false;
      }
    }
    list.push({ qty: r.receivedQuantity, cost, freight });
    result.set(r.request.catalogItemId, list);
  }
  return result;
}

// Pedido del usuario 2026-10-02, SOLO INFORMATIVO (no cambia la contabilidad):
// cuánto vale hoy lo que hay en bodega por los dos métodos — promedio
// ponderado (el que usa el Kardex y la contadora) y por lotes / FIFO (lo que
// costó cada unidad que de verdad queda, compra por compra) — para ver la
// diferencia antes de decidir con la contadora si conviene pasar a FIFO.
export async function getInventoryValuationComparison(): Promise<{ byAverage: number; byLots: number }> {
  const ids = (await prisma.stockKardexEntry.findMany({ distinct: ["catalogItemId"], select: { catalogItemId: true } })).map((e) => e.catalogItemId);
  const [layersById, latest] = await Promise.all([
    replayStockLayers(ids, { includePending: false }),
    prisma.stockKardexEntry.findMany({
      where: { catalogItemId: { in: ids } },
      distinct: ["catalogItemId"],
      orderBy: [{ catalogItemId: "asc" }, { occurredAt: "desc" }, { createdAt: "desc" }],
      select: { balanceAfter: true, avgCostAfter: true },
    }),
  ]);
  const byAverage = latest.reduce((s, e) => s + (e.balanceAfter > 0 ? e.balanceAfter * e.avgCostAfter : 0), 0);
  let byLots = 0;
  for (const layers of layersById.values()) for (const l of layers) if (l.qty > 0) byLots += l.qty * l.cost;
  return { byAverage, byLots };
}

// Pedido del usuario (CEO) 2026-10-02: corregir también el KARDEX de los
// productos donde unidades que entraron a $0 bajaron el promedio (antes solo
// se corregía para los precios). Devuelve los productos con stock cuyo
// promedio del Kardex difiere del promedio sin esas unidades a $0.
export type ZeroCostCorrectionRow = { catalogItemId: string; name: string; code: string | null; balance: number; kardexAvg: number; correctAvg: number };

export async function getZeroCostCorrections(): Promise<ZeroCostCorrectionRow[]> {
  const ids = (await prisma.stockKardexEntry.findMany({ distinct: ["catalogItemId"], select: { catalogItemId: true } })).map((e) => e.catalogItemId);
  const found: { id: string; balance: number; kardexAvg: number; cleanAvg: number }[] = [];
  await replayStockLayers(ids, {
    includePending: false,
    onItemDone: (id, info) => {
      // Solo hacia arriba: las unidades a $0 siempre bajan el promedio; una
      // diferencia hacia abajo es otra cosa (datos raros) y no se toca.
      if (info.balance > 0 && info.cleanAvg - info.kardexAvg >= 0.005) found.push({ id, ...info });
    },
  });
  if (found.length === 0) return [];
  const items = await prisma.purchaseCatalogItem.findMany({ where: { id: { in: found.map((f) => f.id) } }, select: { id: true, name: true, justCode: true } });
  const byId = new Map(items.map((i) => [i.id, i]));
  return found
    .map((f) => ({ catalogItemId: f.id, name: byId.get(f.id)?.name ?? "—", code: byId.get(f.id)?.justCode ?? null, balance: f.balance, kardexAvg: f.kardexAvg, correctAvg: f.cleanAvg }))
    .sort((a, b) => b.balance * (b.correctAvg - b.kardexAvg) - a.balance * (a.correctAvg - a.kardexAvg));
}
