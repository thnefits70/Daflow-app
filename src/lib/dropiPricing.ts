// Fórmula del Precio Dropi sin ninguna dependencia de servidor (Prisma,
// etc.) — para poder usarla también desde componentes "use client" (mismo
// motivo que externalSalesPricingConstants.ts). marketProduct.ts la
// reexporta: una sola fuente de verdad para Stock Actual (INVESTOCK),
// Análisis de Mercado y el precio máximo de compra de abajo.

// Confirmado 2026-09-15/16: mismo default que usa Análisis de Mercado
// (marginPercent ?? 20) cuando un producto todavía no pasó por la
// calculadora de Jariel — usado tanto en Stock Actual como en el Precio
// Dropi de combos.
export const DROPI_MARGIN_DEFAULT = 20;

// Mismo default de fulfillment ($0.75) que ya usaba Stock Actual para
// productos sin propuesta de Jariel — movido acá (2026-09-21) para que
// Compras Personales (precio automático) use exactamente el mismo número,
// sin duplicarlo.
export const DROPI_FULFILLMENT_DEFAULT = 0.75;

// Seguro/garantía por defecto (6%) — el mismo que usa Stock Actual cuando
// el costo viene del Kardex.
export const DROPI_INSURANCE_DEFAULT = 6;

// "Precio puesto en bodega" — proveedor + la parte del flete del lote que le
// toca a esa unidad. Punto de partida compartido por todos los precios de
// venta. Exportada (2026-09-15) para poder mostrarla como su propia columna
// en Stock Actual, sin margen ni seguro encima todavía.
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

// Confirmado 2026-09-23 (idea de Jariel, fórmula pedida por el usuario: "la
// misma del Kardex en INVESTOCK"): para un Ganador no encontrado, el precio
// MÁXIMO al que conviene comprarlo — el que, pasado por la fórmula del
// Precio Dropi de Stock Actual (costo + 6% seguro + $0.75 fulfillment, ÷0.80
// por el 20% de margen), deja nuestro precio como mucho $0.01 por debajo del
// de la competencia. Sin IA: es la misma cuenta al revés.
//
// Escenarios de flete (el proveedor puede cobrar el envío aparte) sacados de
// las compras reales al 2026-09-23: de 162 compras, 32 cobraron flete aparte;
// mediana 1.8% del costo, p90 2.9%, máximo visto 7.8%. Cambiado el mismo
// día (pedido del usuario): solo 2 casos — si el proveedor NO cobra flete,
// o si SÍ lo cobra (se toma el flete alto, 8%, para ir a lo seguro). Se
// quitó el "flete normal" intermedio.
export const UNFOUND_FREIGHT_SCENARIOS = [
  { key: "none", label: "Si no cobra flete", percent: 0 },
  { key: "withFreight", label: "Si cobra flete", percent: 8 },
] as const;

export type MaxPurchaseScenario = {
  key: (typeof UNFOUND_FREIGHT_SCENARIOS)[number]["key"];
  label: string;
  freightPercent: number;
  // null = ni comprándolo casi gratis alcanza el margen.
  maxCost: number | null;
  freightPerUnit: number;
  salePrice: number | null;
};

export function computeMaxPurchasePrices(competitorPrice: number): { targetSalePrice: number; scenarios: MaxPurchaseScenario[] } {
  const targetSalePrice = Math.round((competitorPrice - 0.01) * 100) / 100;
  const scenarios = UNFOUND_FREIGHT_SCENARIOS.map((s) => {
    const salePriceFor = (cost: number) =>
      computeMarketProductSalePrice({
        batchCost: cost,
        batchUnits: 1,
        freightCost: cost * (s.percent / 100),
        insuranceRatePercent: DROPI_INSURANCE_DEFAULT,
        fulfillmentCost: DROPI_FULFILLMENT_DEFAULT,
        marginPercent: DROPI_MARGIN_DEFAULT,
      });
    // Despeje de la fórmula, redondeado HACIA ABAJO al centavo; después se
    // comprueba con la fórmula original y se baja un centavo más si hiciera
    // falta por redondeos, para no pasarnos nunca del precio objetivo.
    const exact = (targetSalePrice * (1 - DROPI_MARGIN_DEFAULT / 100) - DROPI_FULFILLMENT_DEFAULT) / ((1 + s.percent / 100) * (1 + DROPI_INSURANCE_DEFAULT / 100));
    let cents = Math.floor(exact * 100 + 1e-9);
    while (cents > 0 && salePriceFor(cents / 100) > targetSalePrice + 1e-9) cents--;
    const maxCost = cents > 0 ? cents / 100 : null;
    return {
      key: s.key,
      label: s.label,
      freightPercent: s.percent,
      maxCost,
      freightPerUnit: maxCost !== null ? maxCost * (s.percent / 100) : 0,
      salePrice: maxCost !== null ? salePriceFor(maxCost) : null,
    };
  });
  return { targetSalePrice, scenarios };
}
