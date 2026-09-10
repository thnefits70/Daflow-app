import { prisma } from "@/lib/prisma";

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
export function computeMarketProductSalePrice(params: {
  batchCost: number;
  batchUnits: number;
  freightCost: number | null;
  insuranceRatePercent: number;
  fulfillmentCost: number;
  marginPercent: number;
}): number {
  const unitCost = (params.batchCost + (params.freightCost ?? 0) / params.batchUnits) * (1 + params.insuranceRatePercent / 100);
  return (unitCost + params.fulfillmentCost) / (1 - params.marginPercent / 100);
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
