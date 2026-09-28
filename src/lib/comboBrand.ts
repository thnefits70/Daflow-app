import { prisma } from "@/lib/prisma";

// Confirmado 2026-09-28 con el usuario: un combo de Dropi es solo un código
// que agrupa productos reales (los que tienen stock en INVESTOCK), y cada ID
// pertenece a una sola marca. La marca del combo sale SOLA de sus productos
// — nadie la elige a mano (antes Daniel la ponía en Stock Actual). Solo si
// el combo mezcla productos de marcas distintas se usa la marca guardada en
// el combo, que únicamente el admin puede elegir.
export function comboBrand(stored: string | null, componentBrands: (string | null)[]): string | null {
  const brands = [...new Set(componentBrands.filter((b): b is string => !!b))];
  if (brands.length === 1 && !componentBrands.includes(null)) return brands[0];
  return stored;
}

export function comboMixesBrands(componentBrands: (string | null)[]): boolean {
  return new Set(componentBrands.filter(Boolean)).size > 1;
}

// Regla del usuario 2026-09-28: los ID de combo y los ID de productos reales
// nunca se mezclan — un mismo número no puede ser las dos cosas.
export async function comboCodeUsedByProduct(code: string): Promise<string | null> {
  const item = await prisma.purchaseCatalogItem.findUnique({ where: { justCode: code }, select: { name: true } });
  return item ? `El ID ${code} ya es de un producto real ("${item.name}") — un ID de combo no puede ser el mismo que el de un producto.` : null;
}

export async function productIdUsedByCombo(code: string): Promise<string | null> {
  const combo = await prisma.dropiCombo.findUnique({ where: { code }, select: { label: true } });
  return combo ? `El ID ${code} ya es de un combo${combo.label ? ` ("${combo.label}")` : ""} — un producto real no puede tener el mismo ID que un combo.` : null;
}
