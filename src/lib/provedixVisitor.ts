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

export async function logProvedixEvent(data: { visitorId: string; leadId: string | null; type: "visit" | "search" | "product"; query?: string; productCode?: string }) {
  await prisma.provedixEvent
    .create({ data: { visitorId: data.visitorId, leadId: data.leadId, type: data.type, query: data.query?.slice(0, 120) ?? null, productCode: data.productCode ?? null } })
    .catch((e) => console.error("[provedix event]", e));
}
