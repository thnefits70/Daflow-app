// Confirmado por Marcos 2026-10-16: en una devolución de venta externa al
// motorizado se le paga el flete normal que se declaró con la venta
// (freightCost). returnFreightCost solo existe si el asesor lo corrigió a
// mano (0 = no se le debe nada); null = usar el declarado. Así también las
// devoluciones viejas (ej. VE-0037) toman el flete solas.
export function returnFreightAmount(s: { returnFreightCost: number | null; freightCost: number | null }): number {
  return s.returnFreightCost ?? s.freightCost ?? 0;
}

// Mismo criterio para filtrar en Prisma: hay flete de devolución por pagar.
export const HAS_RETURN_FREIGHT = {
  OR: [{ returnFreightCost: { gt: 0 } }, { returnFreightCost: null, freightCost: { gt: 0 } }],
};
