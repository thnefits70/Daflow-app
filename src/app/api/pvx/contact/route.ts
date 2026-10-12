import { NextRequest, NextResponse } from "next/server";
import { logProvedixEvent, readVisitor, setVisitorCookies } from "@/lib/provedixVisitor";

// Clic en "Consultar con el asesor" (WhatsApp) en provedix.com (pedido
// 2026-10-12): se anota qué ID consultaron, para medir la demanda — sobre
// todo de los que están sin stock — y decidir si se recompra.
export async function POST(req: NextRequest) {
  const { visitorId, leadId } = await readVisitor(req);
  const body = await req.json().catch(() => null);
  const code = typeof body?.code === "string" ? body.code.trim().slice(0, 40) : "";
  if (code) await logProvedixEvent({ visitorId, leadId, type: "whatsapp", productCode: code });
  const res = NextResponse.json({ ok: true });
  setVisitorCookies(res, visitorId);
  return res;
}
