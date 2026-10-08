// Confirmado 2026-10-08 (SC-170, Zheng Wu): una sola regla para comparar lo
// escrito contra la cotización, usada por el formulario (para avisar al
// instante), por el servidor al enviar (para bloquear de verdad) y por la
// bandeja de aprobación (para que Bryan vea si algo no cuadra). Sin prisma —
// se importa también desde componentes del navegador.

const IVA_RATE = 0.15;

// El total leído cuadra si es igual a: las líneas, las líneas + el flete que
// cobra el mismo proveedor, o las líneas menos el crédito que se está
// aplicando (el proveedor a veces ya lo resta en su "total a transferir").
export function quoteTotalMatchesLines(p: { readTotal: number | null; linesTotal: number; supplierShipping: number; appliedCreditTotal: number }): boolean {
  if (p.readTotal === null) return false;
  const near = (a: number, b: number) => Math.abs(a - b) < 0.01;
  if (near(p.readTotal, p.linesTotal)) return true;
  if (p.supplierShipping > 0 && near(p.readTotal, p.linesTotal + p.supplierShipping)) return true;
  if (p.appliedCreditTotal > 0) {
    if (near(p.readTotal, Math.max(0, p.linesTotal - p.appliedCreditTotal))) return true;
    if (p.supplierShipping > 0 && near(p.readTotal, Math.max(0, p.linesTotal + p.supplierShipping - p.appliedCreditTotal))) return true;
  }
  return false;
}

// Una línea con código de proveedor: el precio y la cantidad escritos deben
// ser los que la IA leyó para ese código. El precio escrito puede venir ya con
// IVA sumado (casilla "+IVA"), así que también vale el leído × 1.15. Si la IA
// no pudo leer el precio o la cantidad de esa línea, no se bloquea por eso —
// el total igual se exige.
export function quoteLineMatches(it: { quantity: number; unitCost: number; quoteUnitPrice?: number | null; quoteQuantity?: number | null }): boolean {
  if (it.quoteQuantity != null && Math.abs(it.quoteQuantity - it.quantity) >= 0.5) return false;
  if (it.quoteUnitPrice != null) {
    const ok = Math.abs(it.quoteUnitPrice - it.unitCost) < 0.01 || Math.abs(it.quoteUnitPrice * (1 + IVA_RATE) - it.unitCost) < 0.01;
    if (!ok) return false;
  }
  return true;
}
