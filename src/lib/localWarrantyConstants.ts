// Garantías locales (Guayaquil, motorizado propio) — pedido del usuario
// 2026-10-02. Constantes compartidas entre la pantalla del asesor y el
// servidor (sin imports de servidor, para poder usarlas en el navegador).

export type WarrantyReasonCode = "MAL_FUNCIONAMIENTO" | "PRODUCTO_ROTO" | "ORDEN_INCOMPLETA" | "ORDEN_DIFERENTE";

// Plazo desde que salió la guía/venta original: hasta 7 días normal; de 7 a
// 10 solo con doble confirmación; después de 10 ya no se acepta.
export const WARRANTY_NORMAL_DAYS = 7;
export const WARRANTY_MAX_DAYS = 10;

export const WARRANTY_CITY = "GUAYAQUIL";

export function formatWarrantyCode(n: number): string {
  return `GL-${String(n).padStart(4, "0")}`;
}

// Regla de stock acordada con el usuario: si sale una unidad NUEVA de bodega
// (mal funcionamiento, roto) se descuenta; si es la misma unidad que nunca
// salió (orden incompleta/diferente — el corte ya la descontó), no.
export function reasonDiscountsStock(reason: WarrantyReasonCode): boolean {
  return reason === "MAL_FUNCIONAMIENTO" || reason === "PRODUCTO_ROTO";
}

export const WARRANTY_REASONS: { code: WarrantyReasonCode; label: string; explain: string; stock: string; evidence: string | null; warning: string | null }[] = [
  {
    code: "MAL_FUNCIONAMIENTO",
    label: "Mal funcionamiento",
    explain: "El cliente recibió el producto pero no funciona.",
    stock: "Sale una unidad nueva de bodega y se descuenta del stock.",
    evidence: "Adjunta foto o video del producto fallando.",
    warning: null,
  },
  {
    code: "PRODUCTO_ROTO",
    label: "Producto roto",
    explain: "El cliente recibió el producto dañado.",
    stock: "Sale una unidad nueva de bodega y se descuenta del stock.",
    evidence: "Adjunta foto del producto roto.",
    warning: null,
  },
  {
    code: "ORDEN_INCOMPLETA",
    label: "Orden incompleta",
    explain: "Al cliente le faltó este producto (o le llegó menos cantidad) porque no se puso en el paquete.",
    stock: "Esa unidad nunca salió de bodega y el corte ya la descontó: NO se descuenta otra vez, solo se entrega lo que faltó.",
    evidence: null,
    warning: "Usa este motivo solo si estás seguro de que el producto NO salió. Si salió y se perdió en el camino, no es orden incompleta.",
  },
  {
    code: "ORDEN_DIFERENTE",
    label: "Orden diferente",
    explain: "El cliente recibió un producto distinto al que pidió. Se le manda el correcto.",
    stock: "El correcto nunca salió y el corte ya lo descontó: NO se descuenta otra vez. Lo que se mandó por error lo marcas abajo: si el motorizado lo recoge vuelve a bodega; si el cliente se lo queda, sale del stock.",
    evidence: "Adjunta foto de lo que recibió el cliente.",
    warning: null,
  },
];

export function warrantyReasonLabel(code: string | null | undefined): string {
  return WARRANTY_REASONS.find((r) => r.code === code)?.label ?? "—";
}

// Lo que el cliente recibió y no debía: el motorizado lo recoge (vuelve a
// bodega, el stock no cambia porque nunca se descontó) o el cliente se lo
// queda (sale del stock al entregar la garantía).
export type ExtraReasonCode = "ORDEN_DIFERENTE" | "ENVIADO_DE_MAS";
export const EXTRA_REASONS: { code: ExtraReasonCode; label: string }[] = [
  { code: "ORDEN_DIFERENTE", label: "Se le mandó por error (no era lo que pidió)" },
  { code: "ENVIADO_DE_MAS", label: "Se le mandó de más" },
];

export function anyReasonLabel(code: string | null | undefined): string {
  if (code === "ENVIADO_DE_MAS") return "Enviado de más";
  return warrantyReasonLabel(code);
}
