// Cuentas de la calculadora de recompras (pedido del usuario 2026-10-06) sin
// dependencias de servidor, para usarlas igual en el navegador (mientras se
// escribe) y en el servidor (que siempre recalcula, nunca confía en lo que
// manda el navegador). Usa la misma fórmula del Precio Dropi de Stock Actual
// (dropiPricing.ts): costo puesto en bodega + seguro + fulfillment, con el
// margen del producto encima.
import { bodegaUnitCost, computeMarketProductSalePrice } from "@/lib/dropiPricing";

export type RepurchaseVerdict = "GREEN" | "YELLOW" | "RED" | "NO_COMPETITOR";

export const REPURCHASE_VERDICT_LABELS: Record<RepurchaseVerdict, string> = {
  GREEN: "🟢 Conviene recomprar",
  YELLOW: "🟡 Justo",
  RED: "🔴 La competencia lo tiene más barato",
  NO_COMPETITOR: "⚪ Sin competencia para comparar",
};

export type RepurchasePriceParams = { insuranceRatePercent: number; fulfillmentCost: number; marginPercent: number };

export type RepurchaseCalc = {
  // Proveedor + la parte del flete que le toca a cada unidad.
  bodegaCost: number;
  freightPerUnit: number;
  // Precio Dropi que saldría con el costo de hoy y el margen del producto.
  newDropiPrice: number;
  // Margen que quedaría si vendiéramos 1 centavo más barato que la competencia.
  marginAtCompetitor: number | null;
  // Lo máximo que se le puede pagar al proveedor por unidad para quedar 1
  // centavo debajo de la competencia sin bajar del margen (null = ni casi
  // gratis alcanza, o no hay competencia).
  maxSupplierCost: number | null;
  verdict: RepurchaseVerdict;
};

const round2 = (n: number) => Math.round(n * 100) / 100;

export function computeRepurchase(input: {
  unitCost: number;
  freightTotal: number | null;
  quantity: number;
  competitorPrice: number | null;
  params: RepurchasePriceParams;
}): RepurchaseCalc | null {
  const { unitCost, quantity, params } = input;
  if (!(unitCost > 0) || !(quantity > 0) || params.marginPercent >= 100) return null;
  const freight = input.freightTotal && input.freightTotal > 0 ? input.freightTotal : null;
  const bodegaCost = bodegaUnitCost(unitCost, freight, quantity);
  const freightPerUnit = bodegaCost - unitCost;
  const newDropiPrice = computeMarketProductSalePrice({ batchCost: unitCost, batchUnits: quantity, freightCost: freight, ...params });

  const competitorPrice = input.competitorPrice && input.competitorPrice > 0 ? input.competitorPrice : null;
  if (competitorPrice === null) {
    return { bodegaCost, freightPerUnit, newDropiPrice, marginAtCompetitor: null, maxSupplierCost: null, verdict: "NO_COMPETITOR" };
  }

  // Mismo criterio que el precio máximo de Ganadores no encontrados: nuestro
  // precio tiene que quedar al menos 1 centavo debajo de la competencia.
  const target = round2(competitorPrice - 0.01);
  const costWithInsurance = bodegaCost * (1 + params.insuranceRatePercent / 100);
  const marginAtCompetitor = target > 0 ? (1 - (costWithInsurance + params.fulfillmentCost) / target) * 100 : null;
  const exactMaxBodega = (target * (1 - params.marginPercent / 100) - params.fulfillmentCost) / (1 + params.insuranceRatePercent / 100);
  const exactMaxSupplier = exactMaxBodega - freightPerUnit;
  const maxSupplierCost = exactMaxSupplier > 0 ? Math.floor(exactMaxSupplier * 100 + 1e-9) / 100 : null;

  const verdict: RepurchaseVerdict =
    newDropiPrice <= target + 1e-9 ? "GREEN" : marginAtCompetitor !== null && marginAtCompetitor > 0 ? "YELLOW" : "RED";
  return { bodegaCost, freightPerUnit, newDropiPrice, marginAtCompetitor, maxSupplierCost, verdict };
}

// Explicación en palabras simples del veredicto (pantalla y avisos).
export function repurchaseVerdictText(calc: RepurchaseCalc, competitorPrice: number | null, marginPercent: number): string {
  const m = (n: number) => `$${n.toFixed(2)}`;
  if (calc.verdict === "NO_COMPETITOR") return `Sin precio de la competencia. Nuestro precio Dropi con el costo de hoy sería ${m(calc.newDropiPrice)}.`;
  if (calc.verdict === "GREEN")
    return `Nuestro precio Dropi sería ${m(calc.newDropiPrice)}, más barato que la competencia (${m(competitorPrice!)}), y dejamos al menos ${marginPercent}% de margen.`;
  if (calc.verdict === "YELLOW")
    return `Para quedar más barato que la competencia (${m(competitorPrice!)}) solo ganaríamos ${calc.marginAtCompetitor!.toFixed(1)}% (pedimos ${marginPercent}%).${calc.maxSupplierCost !== null ? ` Conviene solo si el proveedor lo deja en ${m(calc.maxSupplierCost)} o menos.` : ""}`;
  return `La competencia lo vende a ${m(competitorPrice!)}: a ese precio perderíamos plata con el costo de hoy.${calc.maxSupplierCost !== null ? ` Solo serviría si el proveedor lo deja en ${m(calc.maxSupplierCost)} o menos.` : ""}`;
}

export function formatRepurchaseCode(code: number): string {
  return `RC-${String(code).padStart(3, "0")}`;
}
