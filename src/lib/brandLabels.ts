// Marcas con que se cuentan las guías del corte (pantalla y hoja impresa del
// manifiesto) — MKT_* es la "Marca" de Stock Actual, ROCKET y SIN_MARCA las
// agrega el conteo (ver guidesByBrand en fulfillmentGuides.ts). Archivo sin
// dependencias de servidor.
export const BRAND_ORDER = ["MKT_PROVEDIX", "MKT_DAMIAN", "MKT_SHANGHAI", "MKT_SUMINISTROS", "ROCKET", "SIN_MARCA"];

const BRAND_LABEL: Record<string, string> = {
  MKT_PROVEDIX: "Provedix",
  MKT_DAMIAN: "Imp. Damián",
  MKT_SHANGHAI: "Imp. Shanghai",
  MKT_SUMINISTROS: "Suministros",
  ROCKET: "Rocket",
  SIN_MARCA: "Sin marca",
};

export function brandLabel(b: string): string {
  return BRAND_LABEL[b] ?? b;
}

export function sortBrands(brands: string[]): string[] {
  const rank = (b: string) => (BRAND_ORDER.indexOf(b) === -1 ? BRAND_ORDER.length : BRAND_ORDER.indexOf(b));
  return [...brands].sort((a, b) => rank(a) - rank(b));
}
