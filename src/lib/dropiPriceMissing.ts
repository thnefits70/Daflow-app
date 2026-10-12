import { prisma } from "@/lib/prisma";
import { getLatestProvedixSnapshot } from "@/lib/provedixSnapshot";
import { auth } from "@/auth";
import { canPublishMarketProduct } from "@/lib/guards";

// Pedido del usuario 2026-10-12: productos que se venden en provedix.com sin
// Precio Dropi registrado (PurchaseCatalogItem.dropiPriceRef). DAFLOW lo
// calcula solo con el costo de las compras, pero muchos se compraron antes de
// DAFLOW y no tienen costo → en provedix.com salen sin "te cuesta" ni
// "ganas aprox.". La asesora B2B escribe UNA vez el precio que está
// PUBLICADO EN DROPI (no el de INVESTOCK) y el producto sale de la lista.
// PROVISIONAL (pedido del usuario 2026-10-12): Yair ayuda a la asesora B2B
// SOLO con esta lista (no con el resto de "Publicar en Dropi"). Su acceso se
// apaga solo cuando ya no quedan productos sin precio — entonces se puede
// quitar este bloque.
export const PROVISIONAL_DROPI_PRICE_HELPERS = new Set(["cmrk1e8l60002b0vna4u0g8gs"]); // YAIR URGILEZ

export async function canFillMissingDropiPrices(): Promise<boolean> {
  if (await canPublishMarketProduct()) return true;
  const session = await auth();
  return !!session && PROVISIONAL_DROPI_PRICE_HELPERS.has(session.user.id);
}

export type MissingDropiPrice = { catalogItemId: string; code: string; name: string; photo: string | null; rank: number; unitsRange: string };

export async function getMissingDropiPrices(): Promise<MissingDropiPrice[]> {
  const snapshot = await getLatestProvedixSnapshot();
  const products = snapshot?.products ?? [];
  if (products.length === 0) return [];
  const items = await prisma.purchaseCatalogItem.findMany({
    where: { justCode: { in: products.map((p) => p.code) }, dropiPriceRef: null },
    select: { id: true, justCode: true, name: true, photos: true },
  });
  const byCode = new Map(items.map((i) => [i.justCode!, i]));
  return products
    .filter((p) => byCode.has(p.code))
    .map((p) => {
      const i = byCode.get(p.code)!;
      return { catalogItemId: i.id, code: p.code, name: i.name, photo: i.photos[0] ?? null, rank: p.rank, unitsRange: p.unitsRange };
    });
}

export async function saveMissingDropiPrice(catalogItemId: string, price: number, userId: string): Promise<{ ok: true } | { ok: false; error: string }> {
  if (!(price >= 0.5 && price <= 2000)) return { ok: false, error: "Escribe el precio tal como está en Dropi (ej. 12.50)." };
  const r = await prisma.purchaseCatalogItem.updateMany({
    where: { id: catalogItemId, dropiPriceRef: null },
    data: { dropiPriceRef: Math.round(price * 100) / 100, dropiPriceRefAt: new Date(), dropiPriceRefById: userId },
  });
  if (r.count === 0) return { ok: false, error: "Este producto ya tiene su Precio Dropi registrado." };
  return { ok: true };
}
