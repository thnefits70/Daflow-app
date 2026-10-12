import { NextRequest, NextResponse, after } from "next/server";
import { prisma } from "@/lib/prisma";
import { logProvedixEvent, readVisitor, setVisitorCookies } from "@/lib/provedixVisitor";
import { checkProvedixSpike } from "@/lib/provedixTraffic";

// Cada vez que alguien abre provedix.com: se cuenta la visita y se dice si
// ya está registrado (para abrir las fichas completas sin pedir datos).
// Una visita de un registrado suma a su contador si pasaron 30+ minutos.
const NEW_VISIT_MS = 30 * 60 * 1000;

export async function POST(req: NextRequest) {
  const { visitorId, leadId } = await readVisitor(req);
  let name: string | null = null;
  if (leadId) {
    const lead = await prisma.provedixLead.findUnique({ where: { id: leadId }, select: { name: true, lastSeenAt: true } });
    if (lead) {
      name = lead.name;
      const now = new Date();
      const isNewVisit = now.getTime() - lead.lastSeenAt.getTime() > NEW_VISIT_MS;
      await prisma.provedixLead.update({ where: { id: leadId }, data: { lastSeenAt: now, ...(isNewVisit ? { visits: { increment: 1 } } : {}) } }).catch(() => null);
    }
  }
  await logProvedixEvent({ visitorId, leadId, type: "visit" });
  // Etapa 4: aviso al admin si hay un pico de visitas (después de responder).
  after(() => checkProvedixSpike().catch((e) => console.error("[provedix spike]", e)));
  const res = NextResponse.json({ registered: !!leadId, name });
  setVisitorCookies(res, visitorId);
  return res;
}
