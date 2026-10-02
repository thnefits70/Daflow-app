import { prisma } from "@/lib/prisma";
import type { MarketProductBodega } from "@/generated/prisma/client";
import { parseGuidesPdf } from "@/lib/dropiGuidesPdf";

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

// Vuelve a leer PDFs de guías ya subidos (uno por manifiesto, así cada uno da
// su propia marca) y aprende la marca de sus IDs. Lo usan el botón del admin
// y el guardado del corte.
export async function learnBrandsFromFiles(fileUrls: string[]): Promise<ManifestLearnResult & { unread: number }> {
  const out: ManifestLearnResult & { unread: number } = { brand: null, combos: [], products: [], conflicts: [], unread: 0 };
  for (const url of fileUrls) {
    try {
      const res = await fetch(url);
      if (!res.ok) {
        out.unread++;
        continue;
      }
      const r = await parseGuidesPdf(new Uint8Array(await res.arrayBuffer()));
      if (r.source !== "DROPI") continue;
      const learned = await learnBrandsFromManifest([...r.lines.map((l) => l.code), ...r.warranty.map((w) => w.code)]);
      out.combos.push(...learned.combos);
      out.products.push(...learned.products);
      out.conflicts.push(...learned.conflicts);
    } catch {
      out.unread++;
    }
  }
  return out;
}

// Pedido del usuario 2026-10-02: los combos e IDs alternos nuevos quedaban
// "Sin marca" porque la marca se aprende al LEER el PDF, y en ese momento el
// combo todavía no existía (se registra después, al revisar o al guardar el
// corte). Al guardar el corte se vuelve a leer la subida si alguno de sus
// combos quedó sin marca.
export async function learnBrandsForNewCombos(codes: string[], fileUrls: string[]): Promise<void> {
  const missing = await prisma.dropiCombo.count({ where: { code: { in: [...new Set(codes)] }, bodega: null } });
  if (missing > 0) await learnBrandsFromFiles(fileUrls);
}
