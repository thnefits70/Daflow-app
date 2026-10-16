import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import {
  logProvedixEvent,
  readVisitor,
  sameOriginRequest,
  hitAllowed,
  tooMany,
} from "@/lib/provedixVisitor";

// Qué busca cada visitante en provedix.com (etapa 4: saber qué les interesa).
// La búsqueda en sí se hace en el navegador; aquí solo se anota.
const schema = z.object({ query: z.string().trim().min(3).max(120) });

export async function POST(req: NextRequest) {
  if (!sameOriginRequest(req))
    return NextResponse.json(
      { error: "Solicitud no permitida." },
      { status: 403 },
    );
  // Límite contra bots (2026-10-16): 60 por minuto por conexión.
  if (!hitAllowed(req, "search", 60, 60_000)) return tooMany();
  const parsed = schema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ ok: true });
  const { visitorId, leadId } = await readVisitor(req);
  await logProvedixEvent({
    visitorId,
    leadId,
    type: "search",
    query: parsed.data.query.toLowerCase(),
  });
  return NextResponse.json({ ok: true });
}
