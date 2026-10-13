import { createHmac, timingSafeEqual } from "crypto";
import { revalidatePath, revalidateTag, unstable_cache } from "next/cache";
import { prisma } from "@/lib/prisma";
import { getLatestProvedixSnapshot, type PublicStock, type SnapshotProduct } from "@/lib/provedixSnapshot";

// Página pública provedix.com (etapa 3, pedido del usuario 2026-10-12).
// Lo que ve CUALQUIERA (sin registrarse): foto, nombre, marca, 🔥 y rango de
// ventas. Lo que ve solo quien se registra con nombre + WhatsApp: ID de
// Dropi, precio al público, margen, ciudades, compradores, entregas y combos.
// Todo sale del resumen diario (ProvedixSnapshot: rangos, 7 días de
// retraso — eso NO se dice en la página, pedido 2026-10-12 —, sin datos de personas) y se guarda en caché para que muchas
// visitas no toquen la base.

export const PROVEDIX_SNAPSHOT_TAG = "provedix-snapshot";
// Lo refresca el Kardex al instante cuando un producto pasa de 0 a tener
// stock o al revés (ver refreshPublicStock en stockKardex.ts).
export const PROVEDIX_STOCK_TAG = "provedix-stock";

export type PublicCard = Pick<SnapshotProduct, "code" | "name" | "brand" | "photo" | "unitsRange" | "soldRange" | "trend" | "rank" | "rocketSkus" | "curve"> & { stock: PublicStock };

const cachedSnapshot = unstable_cache(async () => getLatestProvedixSnapshot(), ["provedix-public-snapshot"], {
  revalidate: 600,
  tags: [PROVEDIX_SNAPSHOT_TAG],
});

// Fotos sin rastro de DAFLOW (pedido del usuario 2026-10-12: nadie debe
// saber que provedix.com está conectada a DAFLOW). La carpeta de Supabase se
// llama "daflow-files" y salía en la dirección de cada foto; acá se cambia a
// /pvx/f/<carpeta>/… y next.config.ts la reenvía a Supabase por dentro. Solo
// las carpetas de fotos de productos — nada más del almacenamiento.
export const PVX_PHOTO_FOLDERS = ["purchase-catalog", "branded-photos", "market-product-reference"] as const;
const STORAGE_PREFIX = `${process.env.NEXT_PUBLIC_SUPABASE_URL ?? ""}/storage/v1/object/public/daflow-files/`;

export function publicPhotoUrl(url: string | null): string | null {
  if (!url || !process.env.NEXT_PUBLIC_SUPABASE_URL || !url.startsWith(STORAGE_PREFIX)) return url;
  const rest = url.slice(STORAGE_PREFIX.length);
  return PVX_PHOTO_FOLDERS.some((f) => rest.startsWith(`${f}/`)) ? `/pvx/f/${rest}` : url;
}

// Stock de INVESTOCK para provedix.com (pedido 2026-10-12): solo sí/no —
// nunca la cantidad. "new" = el producto estaba en 0 y en los últimos 7 días
// entró una compra (se anuncia como "Nuevo stock"). Se lee del Kardex (último
// saldo de cada producto). Se refresca al instante cuando cambia (Kardex) y,
// por si algún otro movimiento no avisa (conteos, ajustes), cada minuto.
const RESTOCK_DAYS = 7;
const cachedStock = unstable_cache(
  async (codes: string[]): Promise<Record<string, PublicStock>> => {
    const items = await prisma.purchaseCatalogItem.findMany({
      where: { justCode: { in: codes }, bodega: { in: ["MKT_PROVEDIX", "MKT_DAMIAN"] } },
      select: { id: true, justCode: true },
    });
    const ids = items.map((i) => i.id);
    const [latest, arrivals] = await Promise.all([
      prisma.stockKardexEntry.findMany({
        where: { catalogItemId: { in: ids } },
        distinct: ["catalogItemId"],
        orderBy: [{ catalogItemId: "asc" }, { occurredAt: "desc" }, { createdAt: "desc" }],
        select: { catalogItemId: true, balanceAfter: true },
      }),
      prisma.stockKardexEntry.findMany({
        where: { catalogItemId: { in: ids }, type: "IN", purchaseRequestReceiptId: { not: null }, occurredAt: { gte: new Date(Date.now() - RESTOCK_DAYS * 86_400_000) } },
        select: { catalogItemId: true, balanceAfter: true, quantity: true },
      }),
    ]);
    const balance = new Map(latest.map((e) => [e.catalogItemId, e.balanceAfter]));
    const restocked = new Set(arrivals.filter((e) => e.balanceAfter - e.quantity <= 0).map((e) => e.catalogItemId));
    const out: Record<string, PublicStock> = {};
    for (const i of items) {
      const b = balance.get(i.id) ?? 0;
      out[i.justCode!] = b <= 0 ? "out" : restocked.has(i.id) ? "new" : "in";
    }
    return out;
  },
  ["provedix-public-stock"],
  { revalidate: 60, tags: [PROVEDIX_SNAPSHOT_TAG, PROVEDIX_STOCK_TAG] },
);

export async function getPublicCatalog(): Promise<{ windowTo: string | null; cards: PublicCard[] }> {
  const s = await cachedSnapshot();
  if (!s) return { windowTo: null, cards: [] };
  const stock = await cachedStock(s.products.map((p) => p.code)).catch(() => ({}) as Record<string, PublicStock>);
  return {
    windowTo: s.windowTo,
    cards: s.products.map((p) => ({ code: p.code, name: p.name, brand: p.brand, photo: publicPhotoUrl(p.photo), unitsRange: p.unitsRange, soldRange: p.soldRange, trend: p.trend, rank: p.rank, rocketSkus: p.rocketSkus ?? [], curve: p.curve, stock: stock[p.code] ?? "in" })),
  };
}

// Números de la portada (rediseño 2026-10-13, elegidos por el usuario):
// productos con ventas, pedidos despachados en 30 días (en RANGO, nunca la
// cifra exacta), ciudades a las que llegaron y productos nuevos del mes
// (artículos del catálogo creados en los últimos 30 días que ya venden).
export type PublicStats = { products: number; orders: string | null; cities: string | null; newProducts: number };

const ORDER_STEPS = [100, 250, 500, 1000, 2500, 5000, 7500, 10000, 15000, 20000, 30000, 50000];

function ordersRange(n: number): string | null {
  let best: number | null = null;
  for (const s of ORDER_STEPS) if (n >= s) best = s;
  return best == null ? null : `+${best.toLocaleString("es-EC")}`;
}

function citiesRange(n: number | undefined): string | null {
  if (!n || n < 10) return null;
  return `+${Math.floor(n / 10) * 10}`;
}

const cachedNewProducts = unstable_cache(
  async (codes: string[]): Promise<number> =>
    prisma.purchaseCatalogItem.count({ where: { justCode: { in: codes }, createdAt: { gte: new Date(Date.now() - 30 * 86_400_000) } } }),
  ["provedix-public-new-products"],
  { revalidate: 3600, tags: [PROVEDIX_SNAPSHOT_TAG] },
);

export async function getPublicStats(): Promise<PublicStats> {
  const s = await cachedSnapshot();
  if (!s) return { products: 0, orders: null, cities: null, newProducts: 0 };
  const newProducts = await cachedNewProducts(s.products.map((p) => p.code)).catch(() => 0);
  return { products: s.products.length, orders: ordersRange(s.guides), cities: citiesRange(s.cityCount), newProducts };
}

export async function getPublicProduct(code: string): Promise<SnapshotProduct | null> {
  const s = await cachedSnapshot();
  const p = s?.products.find((x) => x.code === code);
  if (!p) return null;
  const stock = await cachedStock(s!.products.map((x) => x.code)).catch(() => ({}) as Record<string, PublicStock>);
  return {
    ...p,
    stock: stock[p.code] ?? "in",
    photo: publicPhotoUrl(p.photo),
    combos: p.combos.map((c) => ({ ...c, photos: c.photos.map((u) => publicPhotoUrl(u) ?? u) })),
  };
}

// ---- Cookies -----------------------------------------------------------------
// pvx_lead = "<leadId>.<firma>": solo el servidor puede crearla (firma con
// AUTH_SECRET), así nadie se "registra" escribiendo una cookie a mano.
// pvx_vid = id anónimo del navegador, para contar visitantes.

export const LEAD_COOKIE = "pvx_lead";
export const VISITOR_COOKIE = "pvx_vid";
export const COOKIE_MAX_AGE = 60 * 60 * 24 * 365;

function sign(value: string): string {
  return createHmac("sha256", process.env.AUTH_SECRET ?? "pvx").update(`pvx:${value}`).digest("base64url").slice(0, 32);
}

export function signLead(leadId: string): string {
  return `${leadId}.${sign(leadId)}`;
}

export function verifyLead(cookie: string | undefined | null): string | null {
  if (!cookie) return null;
  const [id, sig] = cookie.split(".");
  if (!id || !sig) return null;
  const expected = sign(id);
  if (sig.length !== expected.length) return null;
  return timingSafeEqual(Buffer.from(sig), Buffer.from(expected)) ? id : null;
}

// WhatsApp: Ecuador 09XXXXXXXX (acepta 9XXXXXXXX, +593…, 593…); otro país,
// con su código (+57…, mínimo 8 dígitos).
export function normalizeWhatsapp(raw: string): string | null {
  const t = raw.trim();
  let d = t.replace(/\D/g, "");
  if (d.startsWith("593") && d.length === 12) d = `0${d.slice(3)}`;
  if (d.length === 9 && d.startsWith("9")) d = `0${d}`;
  if (/^09\d{8}$/.test(d)) return d;
  if (t.startsWith("+") && d.length >= 8 && d.length <= 15) return `+${d}`;
  return null;
}

// Después de recalcular el resumen o de que Robert suba una foto brandeada:
// la página pública se refresca sola (sin esperar los 10 minutos de caché).
export function refreshProvedixPublic(): void {
  try {
    revalidateTag(PROVEDIX_SNAPSHOT_TAG, "max");
    revalidatePath("/pvx");
  } catch (e) {
    console.error("[refreshProvedixPublic]", e);
  }
}
