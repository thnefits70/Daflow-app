import { prisma } from "@/lib/prisma";
import type { MarketProductBodega } from "@/generated/prisma/client";

// Confirmado 2026-09-28 con el usuario: cada PDF de guías que descarga Yair
// es el manifiesto de UNA marca en Dropi (su cuenta), y cada ID (producto o
// combo) pertenece a una sola marca. El PDF no escribe el nombre de la marca,
// pero casi todos sus productos ya la tienen — la mayoría dice de qué marca es
// el manifiesto completo, y con eso el sistema aprende solo la marca de los
// IDs que todavía no la tienen (sobre todo combos). Nadie la elige a mano.
const MIN_SHARE = 0.7;

export async function manifestBrandFor(codes: string[]): Promise<MarketProductBodega | null> {
  if (codes.length === 0) return null;
  const items = await prisma.purchaseCatalogItem.findMany({ where: { justCode: { in: codes }, bodega: { not: null } }, select: { bodega: true } });
  const count = new Map<MarketProductBodega, number>();
  for (const i of items) count.set(i.bodega!, (count.get(i.bodega!) ?? 0) + 1);
  const [top] = [...count.entries()].sort((a, b) => b[1] - a[1]);
  if (!top || top[1] / items.length < MIN_SHARE) return null;
  return top[0];
}

export type ManifestBrandConflict = { kind: "producto" | "combo"; code: string; name: string; stored: MarketProductBodega; manifest: MarketProductBodega };
export type ManifestLearnResult = { brand: MarketProductBodega | null; combos: string[]; products: string[]; conflicts: ManifestBrandConflict[] };

// Pone la marca del manifiesto a los IDs que vienen en él y todavía no la
// tienen. Nunca pisa una marca ya puesta: si no coincide, la devuelve como
// conflicto para que el admin decida.
export async function learnBrandsFromManifest(codes: string[]): Promise<ManifestLearnResult> {
  const unique = [...new Set(codes)];
  const brand = await manifestBrandFor(unique);
  if (!brand) return { brand: null, combos: [], products: [], conflicts: [] };

  const [combos, products] = await Promise.all([
    prisma.dropiCombo.findMany({ where: { code: { in: unique } }, select: { id: true, code: true, label: true, bodega: true } }),
    prisma.purchaseCatalogItem.findMany({ where: { justCode: { in: unique } }, select: { id: true, justCode: true, name: true, bodega: true } }),
  ]);
  const newCombos = combos.filter((c) => !c.bodega);
  const newProducts = products.filter((p) => !p.bodega);
  if (newCombos.length) await prisma.dropiCombo.updateMany({ where: { id: { in: newCombos.map((c) => c.id) } }, data: { bodega: brand } });
  if (newProducts.length) await prisma.purchaseCatalogItem.updateMany({ where: { id: { in: newProducts.map((p) => p.id) } }, data: { bodega: brand } });

  const conflicts: ManifestBrandConflict[] = [
    ...combos.filter((c) => c.bodega && c.bodega !== brand).map((c) => ({ kind: "combo" as const, code: c.code, name: c.label ?? c.code, stored: c.bodega!, manifest: brand })),
    ...products.filter((p) => p.bodega && p.bodega !== brand).map((p) => ({ kind: "producto" as const, code: p.justCode!, name: p.name, stored: p.bodega!, manifest: brand })),
  ];
  return { brand, combos: newCombos.map((c) => c.code), products: newProducts.map((p) => p.justCode!), conflicts };
}
