import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { hitAllowed, logProvedixEvent, readVisitor, sameOriginRequest, setVisitorCookies, tooMany } from "@/lib/provedixVisitor";

// Embudo de Michelle IA (pedido del usuario 2026-10-17): el navegador avisa
// cuándo se abre el chat (y por dónde) y cuándo alguien se registra desde el
// chat. Lo demás (mensajes, respuestas, casos, bloqueos) ya queda en la base.
const body = z.object({
  type: z.enum(["chat_open", "chat_register"]),
  source: z.enum(["enlace", "boton", "producto", "pagina"]).optional(),
});

export async function POST(req: NextRequest) {
  if (!sameOriginRequest(req)) return NextResponse.json({ error: "Solicitud no permitida." }, { status: 403 });
  if (!hitAllowed(req, "chatevent", 30, 60_000)) return tooMany();
  const parsed = body.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "No válido." }, { status: 400 });
  const { visitorId, leadId } = await readVisitor(req);
  await logProvedixEvent({ visitorId, leadId, type: parsed.data.type, query: parsed.data.source });
  const res = NextResponse.json({ ok: true });
  setVisitorCookies(res, visitorId);
  return res;
}
