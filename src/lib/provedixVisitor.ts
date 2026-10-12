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

export function setVisitorCookies(res: NextResponse, visitorId: string, leadCookie?: string) {
  const base = { httpOnly: true, sameSite: "lax" as const, secure: process.env.NODE_ENV === "production", path: "/", maxAge: COOKIE_MAX_AGE };
  res.cookies.set(VISITOR_COOKIE, visitorId, base);
  if (leadCookie) res.cookies.set(LEAD_COOKIE, leadCookie, base);
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

export async function logProvedixEvent(data: { visitorId: string; leadId: string | null; type: "visit" | "search" | "product"; query?: string; productCode?: string }) {
  if (!(await eventAllowed(data.visitorId).catch(() => false))) return;
  await prisma.provedixEvent
    .create({ data: { visitorId: data.visitorId, leadId: data.leadId, type: data.type, query: data.query?.slice(0, 120) ?? null, productCode: data.productCode ?? null } })
    .catch((e) => console.error("[provedix event]", e));
}
