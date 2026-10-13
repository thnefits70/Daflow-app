// Reglas del conteo físico que también usa la pantalla (sin base de datos).
// Pedido del usuario 2026-10-13: diferencia "grande" = más de BIG_DIFF_UNITS
// y más del doble o menos de la mitad de lo esperado; esas se recuentan.
export const BIG_DIFF_UNITS = 20;

export function isBigDifference(counted: number, expected: number): boolean {
  if (Math.abs(counted - expected) <= BIG_DIFF_UNITS) return false;
  return counted > 2 * expected || counted < expected / 2;
}
