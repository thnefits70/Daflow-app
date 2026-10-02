import { prisma } from "@/lib/prisma";
import { normalizeName } from "@/lib/dropiGuidesPdf";
import { getCurrentStockByItemIds } from "@/lib/stockKardex";

// Pedido del usuario 2026-10-02: DAFLOW detecta solo los posibles productos
// duplicados en el catálogo y a Daniel le salen en Inicio para decidir él
// mismo (sin depender del admin): juntarlos (herramienta de siempre,
// catalogItemMerge.ts) o marcar que NO son el mismo (CatalogDuplicateReview,
// para que no vuelva a salir).
// Criterio (probado con el catálogo real: 11 pares): mismo nombre, o uno es
// el nombre del otro con algo más al final ("Camara go pro deportiva" vs
// "CAMARA GO PRO DEPORTIVA 4K"). Nombres muy cortos (<12 letras) no cuentan.

export type DuplicateSide = { id: string; name: string; justCode: string | null; photo: string | null; balance: number };
export type DuplicateCandidate = { pairKey: string; a: DuplicateSide; b: DuplicateSide };

export function duplicatePairKey(aId: string, bId: string): string {
  return [aId, bId].sort().join(":");
}

export async function findDuplicateCandidates(): Promise<DuplicateCandidate[]> {
  const [items, reviewed] = await Promise.all([
    prisma.purchaseCatalogItem.findMany({ select: { id: true, name: true, justCode: true, photos: true } }),
    prisma.catalogDuplicateReview.findMany({ select: { pairKey: true } }),
  ]);
  const done = new Set(reviewed.map((r) => r.pairKey));
  const norm = items.map((i) => ({ ...i, norm: normalizeName(i.name) }));
  const pairs: { a: (typeof norm)[number]; b: (typeof norm)[number] }[] = [];
  for (let i = 0; i < norm.length; i++) {
    for (let j = 0; j < norm.length; j++) {
      if (i === j) continue;
      const A = norm[i];
      const B = norm[j];
      if (A.norm.length < 12) continue;
      const same = A.norm === B.norm && i < j;
      const prefix = A.norm !== B.norm && B.norm.startsWith(`${A.norm} `);
      if (!same && !prefix) continue;
      if (done.has(duplicatePairKey(A.id, B.id))) continue;
      pairs.push({ a: A, b: B });
    }
  }
  if (pairs.length === 0) return [];
  const stock = await getCurrentStockByItemIds([...new Set(pairs.flatMap((p) => [p.a.id, p.b.id]))]);
  const side = (x: (typeof norm)[number]): DuplicateSide => ({ id: x.id, name: x.name, justCode: x.justCode, photo: x.photos[0] ?? null, balance: stock.get(x.id)?.balance ?? 0 });
  return pairs.map((p) => ({ pairKey: duplicatePairKey(p.a.id, p.b.id), a: side(p.a), b: side(p.b) }));
}

export async function dismissDuplicate(aId: string, bId: string, userId: string | null): Promise<void> {
  const pairKey = duplicatePairKey(aId, bId);
  await prisma.catalogDuplicateReview.upsert({
    where: { pairKey },
    update: {},
    create: { pairKey, itemAId: aId, itemBId: bId, decidedById: userId },
  });
}
