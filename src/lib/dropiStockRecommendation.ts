// Pedido del usuario 2026-09-30: stock RECOMENDADO para publicar en Dropi
// (combos y productos). Es solo una recomendación — quien publica decide.
// - Menos de 100 reales: igual se recomienda 100, porque a los dropshippers
//   no les interesa vender algo con poco inventario.
// - 100 o más reales: el doble o más, porque con esa cantidad real se
//   soporta la operación de pedidos de salida.
// Sin dependencias de servidor: se usa también en componentes "use client".
export const DROPI_STOCK_MIN_RECOMMENDED = 100;

export function recommendedDropiStock(realUnits: number): number {
  const real = Math.max(0, Math.floor(realUnits));
  return real < DROPI_STOCK_MIN_RECOMMENDED ? DROPI_STOCK_MIN_RECOMMENDED : real * 2;
}
