import { prisma } from "@/lib/prisma";
import { B2B_MARGIN_OPTIONS, B2B_MARGIN_DEFAULT, B2C_FLETE_PROMEDIO } from "@/lib/externalSalesPricingConstants";
import { getFinanzasDeptId } from "@/lib/inventoryKpis";

import { DROPI_MARGIN_DEFAULT, DROPI_FULFILLMENT_DEFAULT, bodegaUnitCost, computeMarketProductSalePrice } from "@/lib/dropiPricing";

export { B2B_MARGIN_OPTIONS, B2B_MARGIN_DEFAULT, B2C_FLETE_PROMEDIO };
// Movidas a dropiPricing.ts (2026-09-23) para poder usarlas desde el
// navegador (precio máximo de compra de Ganadores no encontrados).
export { DROPI_MARGIN_DEFAULT, DROPI_FULFILLMENT_DEFAULT, bodegaUnitCost, computeMarketProductSalePrice };

// `costSource` deja rastro de qué respaldo se usó — "just" es TEMPORAL
// (pedido explícito del usuario 2026-09-17) mientras se termina de cargar
// INVESTOCK para todos los productos; se quita junto con el respaldo mismo
// cuando eso se complete.
export type CostBasis = {
  batchCost: number;
  batchUnits: number;
  freightCost: number | null;
  insuranceRatePercent: number;
  fulfillmentCost: number;
  costSource: "proposal" | "kardex" | "just";
};

// Confirmado 2026-09-14 (movida acá 2026-09-16 para reusarla desde
// combos, que necesitaban exactamente lo mismo — antes solo vivía sin
// exportar en externalSales.ts): costo base de un producto — en orden de
// prioridad: (1) si pasó por la calculadora de Jariel en Análisis de
// Mercado (MarketProductProposal), se usan sus datos exactos; (2) si no,
// pero ya tiene costo promedio real de Kardex (INVESTOCK) mayor a 0, ese
// costo promedio SE USA DIRECTO como "precio puesto en bodega" (batchUnits:1,
// freightCost:null, seguro 6% por defecto); (3) confirmado 2026-09-17,
// pedido explícito del usuario: si no tiene ninguno de los dos, respaldo
// TEMPORAL con el costo promedio del último archivo de Just (mismo criterio
// que (2): batchUnits:1, freightCost:null, seguro 6%) — mientras INVESTOCK
// se termina de cargar para todos los productos. Si tampoco hay costo de
// Just, el producto no se puede calcular — queda ausente del mapa devuelto.
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
      fulfillmentCost: p.fulfillmentCost,
      costSource: "proposal",
    });
  }

  for (const e of kardexEntries) {
    if (proposalCatalogItemIds.has(e.catalogItemId)) continue;
    if (e.avgCostAfter > 0) byCatalogItemId.set(e.catalogItemId, { batchCost: e.avgCostAfter, batchUnits: 1, freightCost: null, insuranceRatePercent: 6, fulfillmentCost: DROPI_FULFILLMENT_DEFAULT, costSource: "kardex" });
  }

  const stillMissingIds = ids.filter((id) => !byCatalogItemId.has(id));
  if (stillMissingIds.length > 0) {
    const deptId = await getFinanzasDeptId();
    if (deptId) {
      const [items, justSnapshots] = await Promise.all([
        prisma.purchaseCatalogItem.findMany({ where: { id: { in: stillMissingIds }, justCode: { not: null } }, select: { id: true, justCode: true } }),
        prisma.inventoryProductSnapshot.findMany({
          where: { deptId },
          distinct: ["productCode"],
          orderBy: [{ productCode: "asc" }, { createdAt: "desc" }],
          select: { productCode: true, avgCost: true },
        }),
      ]);
      const justAvgCostByCode = new Map(justSnapshots.map((s) => [s.productCode.trim(), s.avgCost]));
      for (const item of items) {
        const justAvgCost = item.justCode ? justAvgCostByCode.get(item.justCode.trim()) : undefined;
        if (justAvgCost && justAvgCost > 0) byCatalogItemId.set(item.id, { batchCost: justAvgCost, batchUnits: 1, freightCost: null, insuranceRatePercent: 6, fulfillmentCost: DROPI_FULFILLMENT_DEFAULT, costSource: "just" });
      }
    }
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
//
// Confirmado 2026-09-22, pedido explícito del usuario: el fulfillment
// ($0.75 por defecto, o el de la propuesta de Jariel) faltaba en el precio
// B2C — se suma junto con bodega+seguro ANTES de dividir por el margen (así
// sí lleva ganancia encima, igual que ya hacía computeMarketProductSalePrice
// para Dropi/B2B), a diferencia del flete promedio que se suma después sin
// margen porque es un costo de envío, no de producto.
export type B2CPriceBreakdown = {
  bodegaUnitCost: number;
  insuranceRatePercent: number;
  priceWithInsurance: number;
  fulfillmentCost: number;
  priceWithFulfillment: number;
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
  fulfillmentCost: number;
  totalQuantity: number;
}): B2CPriceBreakdown | null {
  const marginPercent = b2cMarginPercentForQuantity(params.totalQuantity);
  if (marginPercent == null) return null;
  const bodega = bodegaUnitCost(params.batchCost, params.freightCost, params.batchUnits);
  const priceWithInsurance = bodega * (1 + params.insuranceRatePercent / 100);
  const priceWithFulfillment = priceWithInsurance + params.fulfillmentCost;
  const priceBeforeFreight = priceWithFulfillment / (1 - marginPercent / 100);
  const priceBeforeRounding = priceBeforeFreight + B2C_FLETE_PROMEDIO;
  return {
    bodegaUnitCost: bodega,
    insuranceRatePercent: params.insuranceRatePercent,
    priceWithInsurance,
    fulfillmentCost: params.fulfillmentCost,
    priceWithFulfillment,
    marginPercent,
    priceBeforeFreight,
    fletePromedio: B2C_FLETE_PROMEDIO,
    priceBeforeRounding,
    finalPrice: roundUpToNinetyNineCents(priceBeforeRounding),
  };
}

// Venta al por menor (exclusivo Marcos). El flete promedio se suma DESPUÉS
// de dividir por el margen — no lleva ganancia encima, se pasa tal cual (a
// diferencia del fulfillment, que sí la lleva — ver nota arriba).
export function computeB2CPrice(params: {
  batchCost: number;
  batchUnits: number;
  freightCost: number | null;
  insuranceRatePercent: number;
  fulfillmentCost: number;
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
//
// Confirmado 2026-09-22, pedido explícito del usuario: igual que el resto
// de precios de combo, el fulfillment se cobra UNA SOLA VEZ por combo
// (COMBO_FULFILLMENT_COST), no por cada componente — y lleva margen encima
// como el resto del costo, mismo criterio que computeB2CPriceBreakdown.
export function computeComboB2CPrice(components: ComboComponentInput[], totalQuantity: number): number | null {
  const marginPercent = b2cMarginPercentForQuantity(totalQuantity);
  if (marginPercent == null) return null;
  const sum = components.reduce((acc, c) => {
    const bodega = bodegaUnitCost(c.batchCost, c.freightCost, c.batchUnits) * (1 + c.insuranceRatePercent / 100);
    return acc + (bodega / (1 - marginPercent / 100)) * c.quantity;
  }, 0);
  const fulfillmentWithMargin = COMBO_FULFILLMENT_COST / (1 - marginPercent / 100);
  return roundUpToNinetyNineCents(sum + fulfillmentWithMargin + B2C_FLETE_PROMEDIO);
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

// Confirmado 2026-09-23, reportado por el usuario: a Jariel le seguía
// saliendo "Listo para comprar" (bandeja + aviso en Inicio) de productos que
// ya había comprado (#87, #88, #89). La compra solo quedaba enlazada si se
// entraba por el botón "Comprar en Control de Compras" SIN un borrador
// guardado, y aun así solo con UN producto por solicitud. Ahora cuenta como
// comprado también si existe cualquier solicitud (no rechazada) del mismo
// artículo creada después de marcarse listo.
export async function getReadyToBuyPendingProposalIds(): Promise<string[]> {
  const rows = await prisma.marketProductProposal.findMany({
    where: { readyToBuyAt: { not: null }, purchaseRequests: { none: {} } },
    select: { id: true, catalogItemId: true, readyToBuyAt: true },
  });
  const catalogItemIds = rows.map((r) => r.catalogItemId).filter((id): id is string => !!id);
  if (catalogItemIds.length === 0) return rows.map((r) => r.id);
  const requests = await prisma.purchaseRequest.findMany({
    where: { catalogItemId: { in: catalogItemIds }, status: { not: "REJECTED" } },
    select: { catalogItemId: true, createdAt: true },
  });
  return rows
    .filter((r) => !requests.some((pr) => pr.catalogItemId === r.catalogItemId && pr.createdAt >= r.readyToBuyAt!))
    .map((r) => r.id);
}

// Mismo pedido: al crear una solicitud de compra, cada línea cuyo artículo
// esté "listo para comprar" y todavía sin solicitud se enlaza sola a esa
// propuesta — así la trazabilidad no depende de por dónde entró Jariel.
export async function linkReadyToBuyProposalsToGroup(groupId: string): Promise<void> {
  const requests = await prisma.purchaseRequest.findMany({
    where: { groupId, marketProductProposalId: null },
    select: { id: true, catalogItemId: true },
  });
  if (requests.length === 0) return;
  const proposals = await prisma.marketProductProposal.findMany({
    where: {
      catalogItemId: { in: requests.map((r) => r.catalogItemId) },
      readyToBuyAt: { not: null },
      purchaseRequests: { none: {} },
    },
    select: { id: true, catalogItemId: true },
  });
  for (const p of proposals) {
    const req = requests.find((r) => r.catalogItemId === p.catalogItemId);
    if (req) await prisma.purchaseRequest.update({ where: { id: req.id }, data: { marketProductProposalId: p.id } });
  }
}
