import { prisma } from "@/lib/prisma";
import { B2B_MARGIN_OPTIONS, B2B_MARGIN_DEFAULT, B2C_FLETE_PROMEDIO } from "@/lib/externalSalesPricingConstants";

export { B2B_MARGIN_OPTIONS, B2B_MARGIN_DEFAULT, B2C_FLETE_PROMEDIO };

// Confirmado 2026-09-15/16: mismo default que usa Análisis de Mercado
// (marginPercent ?? 20) cuando un producto todavía no pasó por la
// calculadora de Jariel — usado tanto en Stock Actual como en el Precio
// Dropi de combos.
export const DROPI_MARGIN_DEFAULT = 20;

export type CostBasis = { batchCost: number; batchUnits: number; freightCost: number | null; insuranceRatePercent: number };

// Confirmado 2026-09-14 (movida acá 2026-09-16 para reusarla desde
// combos, que necesitaban exactamente lo mismo — antes solo vivía sin
// exportar en externalSales.ts): costo base de un producto — en orden de
// prioridad: (1) si pasó por la calculadora de Jariel en Análisis de
// Mercado (MarketProductProposal), se usan sus datos exactos; (2) si no,
// pero ya tiene costo promedio real de Kardex (INVESTOCK) mayor a 0, ese
// costo promedio SE USA DIRECTO como "precio puesto en bodega" (batchUnits:1,
// freightCost:null, seguro 6% por defecto); (3) si no tiene ninguno de los
// dos, el producto no se puede calcular — queda ausente del mapa devuelto.
export async function resolveCostBasisForCatalogItems(catalogItemIds: string[]): Promise<Map<string, CostBasis>> {
  const ids = [...new Set(catalogItemIds)];
  if (ids.length === 0) return new Map();

  const [proposals, kardexEntries] = await Promise.all([
    prisma.marketProductProposal.findMany({
      where: { catalogItemId: { in: ids } },
      include: { supplierPrices: true },
    }),
    prisma.stockKardexEntry.findMany({
      where: { catalogItemId: { in: ids } },
      distinct: ["catalogItemId"],
      orderBy: [{ catalogItemId: "asc" }, { occurredAt: "desc" }, { createdAt: "desc" }],
      select: { catalogItemId: true, avgCostAfter: true },
    }),
  ]);

  const byCatalogItemId = new Map<string, CostBasis>();
  const proposalCatalogItemIds = new Set<string>();
  for (const p of proposals) {
    if (!p.catalogItemId) continue;
    const supplier = pickPrimarySupplierPrice(p.supplierPrices);
    if (!supplier) continue;
    proposalCatalogItemIds.add(p.catalogItemId);
    byCatalogItemId.set(p.catalogItemId, {
      batchCost: supplier.batchCost,
      batchUnits: supplier.batchUnits,
      freightCost: supplier.freightCost,
      insuranceRatePercent: p.insuranceRatePercent,
    });
  }

  for (const e of kardexEntries) {
    if (proposalCatalogItemIds.has(e.catalogItemId)) continue;
    if (e.avgCostAfter > 0) byCatalogItemId.set(e.catalogItemId, { batchCost: e.avgCostAfter, batchUnits: 1, freightCost: null, insuranceRatePercent: 6 });
  }

  return byCatalogItemId;
}

// Fase 2 (Análisis de Mercado) — confirmado 2026-09-09 con la especificación
// completa de Bryan (líder de MKT). Nunca se confía en el precio calculado
// que manda el navegador: siempre se recalcula acá, server-side.

// Corregido 2026-09-10, pedido explícito del usuario: `batchCost` es el
// costo POR UNIDAD (lo que Jariel ya escribía sin querer, confundido por el
// rótulo "Costo del lote") — ya NO se divide entre las unidades. El flete sí
// sigue siendo un total por el lote completo (así se cotiza en la realidad),
// así que ese sí se reparte entre las unidades para sacar el flete por
// unidad. Verificado que el ejemplo real ya validado (resultado 2.395) sigue
// dando exactamente igual con costo=1 (antes 100) para el mismo lote de 100
// unidades y flete=10.
// "Precio puesto en bodega" — proveedor + la parte del flete del lote que le
// toca a esa unidad. Punto de partida compartido por todos los precios de
// venta de acá abajo. Exportada (2026-09-15) para poder mostrarla como su
// propia columna en Stock Actual, sin margen ni seguro encima todavía.
export function bodegaUnitCost(batchCost: number, freightCost: number | null, batchUnits: number): number {
  return batchCost + (freightCost ?? 0) / batchUnits;
}

export function computeMarketProductSalePrice(params: {
  batchCost: number;
  batchUnits: number;
  freightCost: number | null;
  insuranceRatePercent: number;
  fulfillmentCost: number;
  marginPercent: number;
}): number {
  const unitCost = bodegaUnitCost(params.batchCost, params.freightCost, params.batchUnits) * (1 + params.insuranceRatePercent / 100);
  return (unitCost + params.fulfillmentCost) / (1 - params.marginPercent / 100);
}

// Confirmado 2026-09-14: precios B2B/B2C para Ventas Externas (Heidy/Jariel/
// Yair venden B2B con pago anticipado; Marcos vende B2C contra entrega o
// anticipado, siempre menos de 12 unidades). Ver memoria
// project_external_sales_pricing_tiers_design — fórmulas ya verificadas
// numéricamente contra un ejemplo real durante el diseño, no re-derivar.

// El costo real del producto, sin ninguna ganancia — bodega + seguro +
// fulfillment. Queda como valor de referencia/calculable, sin pantalla
// propia por ahora.
export function computeBenistockPrice(params: {
  batchCost: number;
  batchUnits: number;
  freightCost: number | null;
  insuranceRatePercent: number;
  fulfillmentCost: number;
}): number {
  const bodega = bodegaUnitCost(params.batchCost, params.freightCost, params.batchUnits);
  return bodega * (1 + params.insuranceRatePercent / 100) + params.fulfillmentCost;
}

// Venta al por mayor (Heidy/Jariel/Yair, siempre pago anticipado). Sin
// fulfillment ni flete — el margen lo elige el asesor (B2B_MARGIN_OPTIONS),
// sin mínimo de unidades forzado por el sistema.
export function computeB2BPrice(params: {
  batchCost: number;
  batchUnits: number;
  freightCost: number | null;
  insuranceRatePercent: number;
  marginPercent: number;
}): number {
  const bodega = bodegaUnitCost(params.batchCost, params.freightCost, params.batchUnits);
  const withInsurance = bodega * (1 + params.insuranceRatePercent / 100);
  return withInsurance / (1 - params.marginPercent / 100);
}

// El margen de B2C es 100% automático según la cantidad TOTAL de la venta
// (sumando todos los productos, aunque sean distintos) — nadie lo elige.
// 12+ unidades ya no es B2C, devuelve null para que el llamador lo rechace.
export function b2cMarginPercentForQuantity(totalQuantity: number): number | null {
  if (totalQuantity < 1) return null;
  if (totalQuantity === 1) return 40;
  if (totalQuantity <= 11) return 30;
  return null;
}

// Confirmado 2026-09-14, pedido explícito del usuario: el precio B2C
// SIEMPRE termina en .99 (precio psicológico) — ej. $15.26 calculado se
// cobra $15.99. Conserva la parte entera (el dólar) y fuerza el centavo a
// .99; nunca baja el precio, solo sube (o queda igual si ya terminaba en
// .99 justo).
function roundUpToNinetyNineCents(price: number): number {
  return Math.floor(price) + 0.99;
}

// Confirmado 2026-09-16, pedido explícito de Marcos: quiere ver el
// desglose de cómo se llegó al precio B2C (no solo el número final) cada
// vez que consulta o declara una venta — ver B2CPriceBreakdownNote en
// ExternalSaleDeclareForm.tsx. Mismos pasos exactos que computeB2CPrice de
// abajo, solo que expone cada paso intermedio en vez de solo el resultado.
export type B2CPriceBreakdown = {
  bodegaUnitCost: number;
  insuranceRatePercent: number;
  priceWithInsurance: number;
  marginPercent: number;
  priceBeforeFreight: number;
  fletePromedio: number;
  priceBeforeRounding: number;
  finalPrice: number;
};

export function computeB2CPriceBreakdown(params: {
  batchCost: number;
  batchUnits: number;
  freightCost: number | null;
  insuranceRatePercent: number;
  totalQuantity: number;
}): B2CPriceBreakdown | null {
  const marginPercent = b2cMarginPercentForQuantity(params.totalQuantity);
  if (marginPercent == null) return null;
  const bodega = bodegaUnitCost(params.batchCost, params.freightCost, params.batchUnits);
  const priceWithInsurance = bodega * (1 + params.insuranceRatePercent / 100);
  const priceBeforeFreight = priceWithInsurance / (1 - marginPercent / 100);
  const priceBeforeRounding = priceBeforeFreight + B2C_FLETE_PROMEDIO;
  return {
    bodegaUnitCost: bodega,
    insuranceRatePercent: params.insuranceRatePercent,
    priceWithInsurance,
    marginPercent,
    priceBeforeFreight,
    fletePromedio: B2C_FLETE_PROMEDIO,
    priceBeforeRounding,
    finalPrice: roundUpToNinetyNineCents(priceBeforeRounding),
  };
}

// Venta al por menor (exclusivo Marcos). El flete promedio se suma DESPUÉS
// de dividir por el margen — no lleva ganancia encima, se pasa tal cual.
export function computeB2CPrice(params: {
  batchCost: number;
  batchUnits: number;
  freightCost: number | null;
  insuranceRatePercent: number;
  totalQuantity: number;
}): number | null {
  return computeB2CPriceBreakdown(params)?.finalPrice ?? null;
}

// Confirmado 2026-09-15, pedido explícito del usuario: precios de referencia
// para un COMBO (DropiCombo — varios productos reales empacados y enviados
// como uno solo). Un combo es distinto de simplemente sumar el precio
// individual de cada producto que trae, porque dos cargos son "por envío",
// no "por producto": el fulfillment ($0.75) y el flete promedio de B2C
// ($7.50). Sumar el precio completo de cada componente los cobraría una vez
// por CADA producto del combo (y multiplicado por su cantidad), cuando en
// realidad el combo se empaca y se envía una sola vez. Por eso estas
// funciones suman solo la parte "costo + seguro (+ margen)" de cada
// componente, y agregan el cargo por envío una sola vez al final.
export const COMBO_FULFILLMENT_COST = 0.75;

export type ComboComponentInput = {
  batchCost: number;
  batchUnits: number;
  freightCost: number | null;
  insuranceRatePercent: number;
  quantity: number;
};

export function computeComboBenistockPrice(components: ComboComponentInput[]): number {
  const sum = components.reduce((acc, c) => {
    const bodega = bodegaUnitCost(c.batchCost, c.freightCost, c.batchUnits) * (1 + c.insuranceRatePercent / 100);
    return acc + bodega * c.quantity;
  }, 0);
  return sum + COMBO_FULFILLMENT_COST;
}

// Confirmado 2026-09-16, pedido explícito del usuario: los combos se suben
// a Dropi, así que necesitan su propio "Precio Dropi" automático — mismo
// criterio que el de un producto individual (bodega con seguro + fulfillment,
// ÷ margen), reusando el Benistock del combo (que ya suma el fulfillment una
// sola vez) en vez de repetir esa suma.
export function computeComboDropiPrice(components: ComboComponentInput[], marginPercent: number): number {
  return computeComboBenistockPrice(components) / (1 - marginPercent / 100);
}

export function computeComboB2BPrice(components: ComboComponentInput[], marginPercent: number): number {
  return components.reduce((acc, c) => acc + computeB2BPrice({ ...c, marginPercent }) * c.quantity, 0);
}

// Igual que computeB2CPrice, el margen (40%/30%) se decide por la cantidad
// TOTAL de combos vendidos en la venta (confirmado 2026-09-15: 1 combo
// vendido = 1 unidad para este cálculo, sin importar cuántos productos
// distintos traiga adentro) — no por la cantidad de productos que trae cada
// combo. El redondeo a .99 se hace una sola vez, sobre el total del combo,
// no por producto.
export function computeComboB2CPrice(components: ComboComponentInput[], totalQuantity: number): number | null {
  const marginPercent = b2cMarginPercentForQuantity(totalQuantity);
  if (marginPercent == null) return null;
  const sum = components.reduce((acc, c) => {
    const bodega = bodegaUnitCost(c.batchCost, c.freightCost, c.batchUnits) * (1 + c.insuranceRatePercent / 100);
    return acc + (bodega / (1 - marginPercent / 100)) * c.quantity;
  }, 0);
  return roundUpToNinetyNineCents(sum + B2C_FLETE_PROMEDIO);
}

export async function nextMarketProductProposalNumber(): Promise<number> {
  const updated = await prisma.platformSettings.update({
    where: { id: "singleton" },
    data: { lastMarketProductProposalNumber: { increment: 1 } },
  });
  return updated.lastMarketProductProposalNumber;
}

export function formatMarketProductProposalCode(n: number): string {
  return `AM-${String(n).padStart(4, "0")}`;
}

// Confirmado 2026-09-09: el proveedor primario (isPrimary=true) es el que
// realmente se usa para el cálculo de precio de venta — el 2° proveedor
// (opcional) es solo referencia comparativa, nunca decide el precio por sí
// solo.
export function pickPrimarySupplierPrice<T extends { isPrimary: boolean }>(prices: T[]): T | null {
  return prices.find((p) => p.isPrimary) ?? prices[0] ?? null;
}

// Confirmado 2026-09-09: al decidir qué comprar (paso 6), el sistema
// sugiere por defecto el proveedor más barato de los cargados en el paso 1
// — Bryan puede elegir otro.
export function cheapestSupplierPrice<T extends { batchCost: number; batchUnits: number; freightCost: number | null }>(
  prices: T[]
): T | null {
  if (prices.length === 0) return null;
  return prices.reduce((cheapest, p) => {
    const unitOf = (x: T) => x.batchCost + (x.freightCost ?? 0) / x.batchUnits;
    return unitOf(p) < unitOf(cheapest) ? p : cheapest;
  }, prices[0]);
}

const PRICE_CHANGE_FIELD_LABELS: Record<string, string> = {
  marginPercent: "Margen de ganancia",
  fulfillmentCost: "Costo de fulfillment",
  insuranceRatePercent: "% de seguro",
};

export function priceChangeFieldLabel(field: string): string {
  return PRICE_CHANGE_FIELD_LABELS[field] ?? field;
}

export type ProposalTraceability = {
  proposedAt: Date;
  proposedByName: string | null;
  reviewedAt: Date | null;
  reviewedByName: string | null;
  publishedAt: Date | null;
  publishedByName: string | null;
  brandedAt: Date | null;
  brandedByName: string | null;
  totalMinutes: number | null;
};

// Confirmado 2026-09-09: pedido explícito de Bryan — poder ver, por cada
// producto, quién hizo cada paso, cuándo, y cuánto tardó todo el proceso
// desde que Jariel lo propuso hasta que Robert terminó de brandear. No
// existía ninguna vista parecida en toda la app antes de esto.
export function computeProposalTraceability(p: {
  proposedAt: Date;
  proposedBy: { name: string } | null;
  reviewedAt: Date | null;
  reviewedBy: { name: string } | null;
  publishedAt: Date | null;
  publishedBy: { name: string } | null;
  brandedAt: Date | null;
  brandedBy: { name: string } | null;
}): ProposalTraceability {
  const totalMinutes = p.brandedAt ? Math.round((p.brandedAt.getTime() - p.proposedAt.getTime()) / 60000) : null;
  return {
    proposedAt: p.proposedAt,
    proposedByName: p.proposedBy?.name ?? null,
    reviewedAt: p.reviewedAt,
    reviewedByName: p.reviewedBy?.name ?? null,
    publishedAt: p.publishedAt,
    publishedByName: p.publishedBy?.name ?? null,
    brandedAt: p.brandedAt,
    brandedByName: p.brandedBy?.name ?? null,
    totalMinutes,
  };
}
