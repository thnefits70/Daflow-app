import { prisma } from "@/lib/prisma";
import { NO_BRAND } from "@/lib/fulfillmentGuides";
import { guideBrandsByManifest } from "@/lib/manifestGuideBrand";

// Marca de cada guía — mismo criterio que "Guías por marca" del corte
// (fulfillmentGuides.ts): la marca del manifiesto en que vino la guía (ver
// manifestGuideBrand.ts); en guías de antes, la de los productos de su
// etiqueta y, si no los guardó, la del batch. Rocket va aparte. Lo usan el gráfico semanal de
// Pedidos despachados (dashboard.ts) y la sección Provedix.
export type BrandBatch = {
  source: string;
  guides: { guideNumber: string; codes: string[]; manifestFile: number | null }[];
  items: { sourceCode: string; fromComboCode: string | null; catalogItem: { bodega: string | null } }[];
};

export async function guideBrandsOf(batches: BrandBatch[]): Promise<Map<string, string>> {
  const brandByCode = new Map<string, string>();
  const comboCodes = [...new Set(batches.flatMap((b) => b.items.map((i) => i.fromComboCode)).filter((c): c is string => !!c))];
  const combos = comboCodes.length ? await prisma.dropiCombo.findMany({ where: { code: { in: comboCodes } }, select: { code: true, bodega: true } }) : [];
  for (const c of combos) if (c.bodega) brandByCode.set(c.code, c.bodega);
  for (const b of batches) {
    for (const it of b.items) {
      // Un ID alterno de combo (sourceCode) lleva la marca de su madre
      // (fromComboCode) — pedido del usuario 2026-10-10.
      const brand = it.fromComboCode ? brandByCode.get(it.fromComboCode) : it.catalogItem.bodega;
      if (brand && !brandByCode.has(it.sourceCode)) brandByCode.set(it.sourceCode, brand);
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
    // Marca del manifiesto en que vino cada guía (pedido de Daniel 2026-10-12).
    for (const [g, brand] of guideBrandsByManifest(b.source, b.guides, brandByCode, batchBrand)) out.set(g, brand);
  }
  return out;
}
