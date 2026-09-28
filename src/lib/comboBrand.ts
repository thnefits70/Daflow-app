import { prisma } from "@/lib/prisma";

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
