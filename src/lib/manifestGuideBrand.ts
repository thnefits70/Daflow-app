import { isRocketCode } from "@/lib/dropiGuidesPdf";

// Pedido de Daniel 2026-10-12 (sí del usuario): cada guía cuenta en la marca
// del MANIFIESTO (PDF) en que vino, no en la de su producto. Caso real
// MF-0078: la guía D002118823 vino en el manifiesto Gintracom de Imp. Damián
// con el ID 130583 (de Imp. Damián), unido al ID madre 146435 de Provedix —
// salía Provedix 210 / Imp. Damián 36 y los manifiestos decían 209 / 37.
// La marca del manifiesto = la que tienen la mayoría de sus guías. Rocket va
// siempre aparte. Guías sin manifestFile (de antes) siguen con su producto
// y, si no, con `fallback`.
export type ManifestBrandGuide = { guideNumber: string; codes: string[]; manifestFile: number | null };

export function guideBrandsByManifest(
  source: string,
  guides: ManifestBrandGuide[],
  brandByCode: Map<string, string>,
  fallback: string
): Map<string, string> {
  const rocketOf = (g: ManifestBrandGuide) => source === "ROCKET" || /^RKT/i.test(g.guideNumber) || g.codes.some(isRocketCode);
  const own = (g: ManifestBrandGuide) => g.codes.map((c) => brandByCode.get(c)).find(Boolean) ?? null;

  const tally = new Map<number, Map<string, number>>();
  for (const g of guides) {
    if (g.manifestFile === null || rocketOf(g)) continue;
    const b = own(g);
    if (!b) continue;
    const m = tally.get(g.manifestFile) ?? new Map<string, number>();
    m.set(b, (m.get(b) ?? 0) + 1);
    tally.set(g.manifestFile, m);
  }
  const fileBrand = new Map([...tally].map(([f, m]) => [f, [...m].sort((x, y) => y[1] - x[1])[0][0]] as const));

  const out = new Map<string, string>();
  for (const g of guides) {
    const brand = rocketOf(g) ? "ROCKET" : (g.manifestFile !== null ? fileBrand.get(g.manifestFile) : undefined) ?? own(g) ?? fallback;
    out.set(g.guideNumber, brand);
  }
  return out;
}
