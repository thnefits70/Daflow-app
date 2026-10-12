import { createHmac, timingSafeEqual } from "crypto";
import { revalidatePath, revalidateTag, unstable_cache } from "next/cache";
import { getLatestProvedixSnapshot, type SnapshotProduct } from "@/lib/provedixSnapshot";

// Página pública provedix.com (etapa 3, pedido del usuario 2026-10-12).
// Lo que ve CUALQUIERA (sin registrarse): foto, nombre, marca, 🔥 y rango de
// ventas. Lo que ve solo quien se registra con nombre + WhatsApp: ID de
// Dropi, precio al público, margen, ciudades, compradores, entregas y combos.
// Todo sale del resumen diario (ProvedixSnapshot: rangos, 7 días de
// retraso, sin datos de personas) y se guarda en caché para que muchas
// visitas no toquen la base.

export const PROVEDIX_SNAPSHOT_TAG = "provedix-snapshot";

export type PublicCard = Pick<SnapshotProduct, "code" | "name" | "brand" | "photo" | "unitsRange" | "soldRange" | "trend" | "rank">;

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

export async function getPublicCatalog(): Promise<{ windowTo: string | null; cards: PublicCard[] }> {
  const s = await cachedSnapshot();
  if (!s) return { windowTo: null, cards: [] };
  return {
    windowTo: s.windowTo,
    cards: s.products.map((p) => ({ code: p.code, name: p.name, brand: p.brand, photo: publicPhotoUrl(p.photo), unitsRange: p.unitsRange, soldRange: p.soldRange, trend: p.trend, rank: p.rank })),
  };
}

export async function getPublicProduct(code: string): Promise<SnapshotProduct | null> {
  const s = await cachedSnapshot();
  const p = s?.products.find((x) => x.code === code);
  if (!p) return null;
  return {
    ...p,
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
