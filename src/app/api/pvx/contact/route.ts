import { NextRequest, NextResponse } from "next/server";
import {
  logProvedixEvent,
  readVisitor,
  sameOriginRequest,
  setVisitorCookies,
  hitAllowed,
  tooMany,
} from "@/lib/provedixVisitor";

// Clic en "Consultar con el asesor" (WhatsApp) en provedix.com (pedido
// 2026-10-12): se anota qué ID consultaron, para medir la demanda — sobre
// todo de los que están sin stock — y decidir si se recompra.
export async function POST(req: NextRequest) {
  if (!sameOriginRequest(req))
    return NextResponse.json(
      { error: "Solicitud no permitida." },
      { status: 403 },
    );
  // Límite contra bots (2026-10-16): 30 cada 10 min por conexión.
  if (!hitAllowed(req, "contact", 30, 10 * 60_000)) return tooMany();
  const { visitorId, leadId } = await readVisitor(req);
  const body = await req.json().catch(() => null);
  const raw =
    typeof body?.code === "string" ? body.code.trim().slice(0, 40) : "";
  // Solo IDs o "PORTADA-…" (letras, números y guiones): nada de texto libre.
  const code = /^[A-Za-z0-9-]{1,40}$/.test(raw) ? raw : "";
  if (code)
    await logProvedixEvent({
      visitorId,
      leadId,
      type: "whatsapp",
      productCode: code,
    });
  const res = NextResponse.json({ ok: true });
  setVisitorCookies(res, visitorId);
  return res;
}
