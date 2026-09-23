import { NextRequest, NextResponse } from "next/server";
import { runInventoryAutoFlows } from "@/lib/inventoryAutoFlows";

// Confirmado 2026-09-23, pedido explícito del usuario: además del barrido de
// las 8:00 (que corre dentro de push-pendientes, antes de mandar los avisos),
// un segundo barrido al mediodía (ver vercel.json) que SOLO cierra lo que
// quedó esperando en el inventario — no manda avisos, para que nadie reciba
// sus pendientes dos veces al día. Mismo CRON_SECRET que push-pendientes.
export async function GET(req: NextRequest) {
  const auth = req.headers.get("authorization");
  if (auth !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: "No autorizado." }, { status: 401 });
  }

  await runInventoryAutoFlows();
  return NextResponse.json({ ok: true });
}
