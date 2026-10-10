import { prisma } from "@/lib/prisma";
import { isRocketCode } from "@/lib/dropiGuidesPdf";
import { NO_BRAND } from "@/lib/fulfillmentGuides";

// Marca de cada guía — mismo criterio que "Guías por marca" del corte
// (fulfillmentGuides.ts): la marca sale de los productos de la etiqueta; si
// la guía no los guardó, de la marca del PDF entero (cada PDF de Dropi es el
// manifiesto de UNA marca). Rocket va aparte. Lo usan el gráfico semanal de
// Pedidos despachados (dashboard.ts) y la sección Provedix.
export type BrandBatch = {
  source: string;
  guides: { guideNumber: string; codes: string[] }[];
  items: { sourceCode: string; fromComboCode: string | null; catalogItem: { bodega: string | null } }[];
};

export async function guideBrandsOf(batches: BrandBatch[]): Promise<Map<string, string>> {
  const brandByCode = new Map<string, string>();
  const comboCodes = [...new Set(batches.flatMap((b) => b.items.map((i) => i.fromComboCode)).filter((c): c is string => !!c))];
  const combos = comboCodes.length ? await prisma.dropiCombo.findMany({ where: { code: { in: comboCodes } }, select: { code: true, bodega: true } }) : [];
  for (const c of combos) if (c.bodega) brandByCode.set(c.code, c.bodega);
  for (const b of batches) {
    for (const it of b.items) {
      if (it.fromComboCode) continue;
      if (it.catalogItem.bodega && !brandByCode.has(it.sourceCode)) brandByCode.set(it.sourceCode, it.catalogItem.bodega);
    }
  }

  const out = new Map<string, string>();
  for (const b of batches) {
    // Marca del PDF: la que tienen la mayoría de sus productos.
    const tally = new Map<string, number>();
    for (const it of b.items) {
      const brand = brandByCode.get(it.fromComboCode ?? it.sourceCode);
      if (brand) tally.set(brand, (tally.get(brand) ?? 0) + 1);
    }
    const batchBrand = [...tally.entries()].sort((x, y) => y[1] - x[1])[0]?.[0] ?? NO_BRAND;
    for (const g of b.guides) {
      const rocket = b.source === "ROCKET" || /^RKT/i.test(g.guideNumber) || g.codes.some(isRocketCode);
      out.set(g.guideNumber, rocket ? "ROCKET" : (g.codes.map((c) => brandByCode.get(c)).find(Boolean) ?? batchBrand));
    }
  }
  return out;
}
