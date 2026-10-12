import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { logProvedixEvent, readVisitor } from "@/lib/provedixVisitor";

// Qué busca cada visitante en provedix.com (etapa 4: saber qué les interesa).
// La búsqueda en sí se hace en el navegador; aquí solo se anota.
const schema = z.object({ query: z.string().trim().min(3).max(120) });

export async function POST(req: NextRequest) {
  const parsed = schema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ ok: true });
  const { visitorId, leadId } = await readVisitor(req);
  await logProvedixEvent({ visitorId, leadId, type: "search", query: parsed.data.query.toLowerCase() });
  return NextResponse.json({ ok: true });
}
