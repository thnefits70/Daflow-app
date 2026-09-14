// Confirmado 2026-09-14: constantes de precios B2B/B2C sin ninguna
// dependencia de servidor (Prisma, etc.) — para poder importarlas también
// desde componentes "use client" (src/lib/marketProduct.ts sí importa
// prisma, así que no se puede importar directo ahí desde el navegador).
// marketProduct.ts reexporta e importa desde acá, una sola fuente de verdad.
export const B2B_MARGIN_OPTIONS = [20, 25, 30, 35, 40, 45, 50] as const;
export const B2B_MARGIN_DEFAULT = 20;
export const B2C_FLETE_PROMEDIO = 7.5;
