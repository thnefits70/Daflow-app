import { randomUUID } from "crypto";
import type { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { COOKIE_MAX_AGE, LEAD_COOKIE, VISITOR_COOKIE, verifyLead } from "@/lib/provedixPublic";

// Quién está mirando provedix.com: visitante anónimo (cookie pvx_vid) y, si
// ya se registró, su ficha de la cartera (cookie firmada pvx_lead).
export async function readVisitor(req: NextRequest): Promise<{ visitorId: string; isNew: boolean; leadId: string | null }> {
  const existing = req.cookies.get(VISITOR_COOKIE)?.value;
  const visitorId = existing && /^[\w-]{8,64}$/.test(existing) ? existing : randomUUID();
  let leadId = verifyLead(req.cookies.get(LEAD_COOKIE)?.value);
  // Registro borrado: la cookie ya no vale.
  if (leadId && !(await prisma.provedixLead.findUnique({ where: { id: leadId }, select: { id: true } }))) leadId = null;
  return { visitorId, isNew: visitorId !== existing, leadId };
}

// Nombre para el saludo "Hola, …" (2026-10-14): el que escribió quien usa
// ESTE navegador, nunca el guardado en la base — si alguien se registra con
// el número de otra persona no puede ver su nombre real.
export const NAME_COOKIE = "pvx_nm";

export function setVisitorCookies(res: NextResponse, visitorId: string, leadCookie?: string, displayName?: string) {
  const base = { httpOnly: true, sameSite: "lax" as const, secure: process.env.NODE_ENV === "production", path: "/", maxAge: COOKIE_MAX_AGE };
  res.cookies.set(VISITOR_COOKIE, visitorId, base);
  if (leadCookie) res.cookies.set(LEAD_COOKIE, leadCookie, base);
  if (displayName) res.cookies.set(NAME_COOKIE, encodeURIComponent(displayName.slice(0, 40)), base);
}

export function readDisplayName(req: NextRequest): string | null {
  const v = req.cookies.get(NAME_COOKIE)?.value;
  if (!v) return null;
  try {
    return decodeURIComponent(v).slice(0, 40) || null;
  } catch {
    return null;
  }
}

// Límite de intentos (seguridad, 2026-10-12): un robot que abre la página
// miles de veces no llena la base. Más de 20 anotaciones del mismo navegador
// por minuto, o más de 600 en total por minuto, ya no se guardan (la página
// sigue funcionando igual para la persona).
const MINUTE = 60_000;
const MAX_PER_VISITOR_MIN = 20;
const MAX_TOTAL_MIN = 600;

async function eventAllowed(visitorId: string): Promise<boolean> {
  const since = new Date(Date.now() - MINUTE);
  const [mine, total] = await Promise.all([
    prisma.provedixEvent.count({ where: { visitorId, createdAt: { gte: since } } }),
    prisma.provedixEvent.count({ where: { createdAt: { gte: since } } }),
  ]);
  return mine < MAX_PER_VISITOR_MIN && total < MAX_TOTAL_MIN;
}

// Registro: máximo 5 por minuto desde la misma conexión (en cada servidor) y
// 60 en total cada 10 minutos — una avalancha de registros falsos se frena.
const registerHits = new Map<string, number[]>();

export async function registerAllowed(req: NextRequest): Promise<boolean> {
  const ip = (req.headers.get("x-forwarded-for") ?? "").split(",")[0].trim() || "?";
  const now = Date.now();
  const hits = (registerHits.get(ip) ?? []).filter((t) => now - t < MINUTE);
  hits.push(now);
  registerHits.set(ip, hits);
  if (registerHits.size > 5000) registerHits.clear();
  if (hits.length > 5) return false;
  const recent = await prisma.provedixLead.count({ where: { createdAt: { gte: new Date(now - 10 * MINUTE) } } });
  return recent < 60;
}

// Seguridad (2026-10-14): las acciones (registro, visitas, búsquedas, clics)
// solo se aceptan si vienen de la misma página — otra web no puede hacer que
// el navegador de un visitante las envíe por él.
export function sameOriginRequest(req: NextRequest): boolean {
  const from = req.headers.get("origin") ?? req.headers.get("referer");
  if (!from) return false;
  try {
    const host = new URL(from).host.toLowerCase();
    const own = (req.headers.get("x-forwarded-host") ?? req.headers.get("host") ?? "").toLowerCase();
    return host === own || host === "provedix.com" || host === "www.provedix.com";
  } catch {
    return false;
  }
}

// Fichas completas: máximo 40 cada 10 minutos por persona registrada y por
// conexión (en cada servidor), y 300 por hora por registrado según lo
// anotado — un robot registrado no puede bajarse todo el catálogo de golpe.
const productHits = new Map<string, number[]>();
const PRODUCT_WINDOW = 10 * MINUTE;
const MAX_PRODUCTS_WINDOW = 40;

export async function productViewAllowed(req: NextRequest, leadId: string): Promise<boolean> {
  const ip = (req.headers.get("x-forwarded-for") ?? "").split(",")[0].trim() || "?";
  const now = Date.now();
  for (const key of [`l:${leadId}`, `i:${ip}`]) {
    const hits = (productHits.get(key) ?? []).filter((t) => now - t < PRODUCT_WINDOW);
    hits.push(now);
    productHits.set(key, hits);
    if (hits.length > MAX_PRODUCTS_WINDOW) return false;
  }
  if (productHits.size > 5000) productHits.clear();
  const lastHour = await prisma.provedixEvent.count({ where: { leadId, type: "product", createdAt: { gte: new Date(now - 60 * MINUTE) } } });
  return lastHour < 300;
}

export async function logProvedixEvent(data: { visitorId: string; leadId: string | null; type: "visit" | "search" | "product" | "whatsapp"; query?: string; productCode?: string }) {
  if (!(await eventAllowed(data.visitorId).catch(() => false))) return;
  await prisma.provedixEvent
    .create({ data: { visitorId: data.visitorId, leadId: data.leadId, type: data.type, query: data.query?.slice(0, 120) ?? null, productCode: data.productCode ?? null } })
    .catch((e) => console.error("[provedix event]", e));
}
