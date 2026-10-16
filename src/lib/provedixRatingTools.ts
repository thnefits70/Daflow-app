// Herramientas que se califican en provedix.com (2026-10-15). Aparte de
// provedixRatings.ts para que la pantalla del admin no cargue la base.
export const RATING_TOOLS = {
  catalogo: "Catálogo de productos",
  datos: "Datos de venta",
  calculadora: "Calculadora de ganancia",
  michelle: "Michelle IA",
} as const;
export type RatingTool = keyof typeof RATING_TOOLS;

export function isRatingTool(v: unknown): v is RatingTool {
  return typeof v === "string" && v in RATING_TOOLS;
}

// Meta sugerida para mostrar opiniones en la página.
export const PUBLIC_MIN_RATINGS = 20;
export const PUBLIC_MIN_AVG = 4.5;
