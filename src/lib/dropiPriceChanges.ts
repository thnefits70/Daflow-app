import { prisma } from "@/lib/prisma";
import { DROPI_MARGIN_DEFAULT, computeMarketProductSalePrice, resolveCostBasisForCatalogItems } from "@/lib/marketProduct";

// Pedido del usuario 2026-10-02: el Precio Dropi cambia solo con las compras
// (sellingCost.ts) y Dropi no está conectado — se le avisa a quien publica
// (asesora B2B) cuando conviene cambiarlo en Dropi, midiendo contra el
// último precio que ella confirmó (PurchaseCatalogItem.dropiPriceRef):
// - Sube 2% o más (y al menos $0.10) → aviso, para no quedar bajo el 20%.
//   Subir 1 centavo no vale la pena (regla del usuario).
// - Baja 3% o más (y al menos $0.25) → aviso para bajarlo y competir.
// Los cambios chicos se van sumando: siempre se mide contra lo confirmado.
// Sin precio de referencia (producto recién publicado o el día que se subió
// esto) se toma el de ese momento, sin aviso — solo cambios de ahí en
// adelante (decisión del usuario).
export const DROPI_PRICE_RISE_PERCENT = 2;
export const DROPI_PRICE_RISE_MIN = 0.1;
export const DROPI_PRICE_DROP_PERCENT = 3;
export const DROPI_PRICE_DROP_MIN = 0.25;

export type DropiPriceChange = {
  catalogItemId: string;
  name: string;
  code: string;
  photo: string | null;
  refPrice: number;
  newPrice: number;
  direction: "UP" | "DOWN";
};

const publishedWhere = {
  justCode: { not: null },
  pendingRegistration: false,
  OR: [{ bodega: null }, { bodega: { not: "MKT_SUMINISTROS" as const } }],
};

const round2 = (n: number) => Math.round(n * 100) / 100;

export async function currentDropiPrices(catalogItemIds: string[]): Promise<Map<string, number>> {
  const bases = await resolveCostBasisForCatalogItems(catalogItemIds);
  const out = new Map<string, number>();
  for (const [id, b] of bases) out.set(id, round2(computeMarketProductSalePrice({ ...b, marginPercent: b.marginPercent ?? DROPI_MARGIN_DEFAULT })));
  return out;
}

export function classifyDropiPriceChange(refPrice: number, newPrice: number): "UP" | "DOWN" | null {
  const diff = newPrice - refPrice;
  if (diff >= DROPI_PRICE_RISE_MIN - 1e-9 && diff >= (refPrice * DROPI_PRICE_RISE_PERCENT) / 100 - 1e-9) return "UP";
  if (-diff >= DROPI_PRICE_DROP_MIN - 1e-9 && -diff >= (refPrice * DROPI_PRICE_DROP_PERCENT) / 100 - 1e-9) return "DOWN";
  return null;
}

export async function getDropiPriceChanges(): Promise<DropiPriceChange[]> {
  const items = await prisma.purchaseCatalogItem.findMany({
    where: publishedWhere,
    select: { id: true, name: true, justCode: true, photos: true, dropiPriceRef: true },
  });
  if (items.length === 0) return [];
  const prices = await currentDropiPrices(items.map((i) => i.id));

  // Primera vez para estos productos: se toma el precio de hoy, sin aviso.
  const missing = items.filter((i) => i.dropiPriceRef == null && prices.has(i.id));
  if (missing.length > 0) {
    const now = new Date();
    await prisma.$transaction(
      missing.map((i) =>
        prisma.purchaseCatalogItem.updateMany({
          where: { id: i.id, dropiPriceRef: null },
          data: { dropiPriceRef: prices.get(i.id)!, dropiPriceRefAt: now, dropiPriceRefById: null },
        })
      )
    );
  }

  const changes: DropiPriceChange[] = [];
  for (const i of items) {
    const newPrice = prices.get(i.id);
    if (i.dropiPriceRef == null || newPrice == null) continue;
    const direction = classifyDropiPriceChange(i.dropiPriceRef, newPrice);
    if (!direction) continue;
    changes.push({ catalogItemId: i.id, name: i.name, code: i.justCode!, photo: i.photos[0] ?? null, refPrice: i.dropiPriceRef, newPrice, direction });
  }
  // Primero las subidas (riesgo de ganar menos), luego las más grandes.
  return changes.sort((a, b) => (a.direction === b.direction ? Math.abs(b.newPrice / b.refPrice - 1) - Math.abs(a.newPrice / a.refPrice - 1) : a.direction === "UP" ? -1 : 1));
}

// "Ya lo cambié en Dropi": el precio confirmado pasa a ser el de hoy
// (calculado en el servidor). Si cambió desde que lo vio, no se confirma
// para que no quede en Dropi un precio distinto al registrado.
export async function confirmDropiPriceChange(catalogItemId: string, shownPrice: number, userId: string): Promise<{ ok: true; price: number } | { ok: false; error: string }> {
  const item = await prisma.purchaseCatalogItem.findFirst({ where: { id: catalogItemId, ...publishedWhere }, select: { id: true } });
  if (!item) return { ok: false, error: "Este producto no está publicado en Dropi." };
  const price = (await currentDropiPrices([catalogItemId])).get(catalogItemId);
  if (price == null) return { ok: false, error: "Este producto todavía no tiene costo para calcular el precio." };
  if (Math.abs(price - shownPrice) > 0.005) return { ok: false, error: `El precio acaba de cambiar a $${price.toFixed(2)}. Ponlo en Dropi y vuelve a confirmar.` };
  await prisma.purchaseCatalogItem.update({ where: { id: catalogItemId }, data: { dropiPriceRef: price, dropiPriceRefAt: new Date(), dropiPriceRefById: userId } });
  return { ok: true, price };
}
