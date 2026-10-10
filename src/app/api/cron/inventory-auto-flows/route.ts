import { NextRequest, NextResponse } from "next/server";
import { runInventoryAutoFlows } from "@/lib/inventoryAutoFlows";
import { backfillGuideMarketData } from "@/lib/localWarranty";
import { saveProvedixSnapshot } from "@/lib/provedixSnapshot";

// Leer los PDF de cortes viejos toma tiempo (ver backfillGuideMarketData).
export const maxDuration = 300;

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
  // Ciudad/valor/sexo/tienda de las guías que todavía no los tienen
  // (pedido del usuario 2026-10-10, provedix.com). Al final y con tope de
  // tiempo, para no frenar lo de arriba.
  const marketBatches = await backfillGuideMarketData(150_000).catch((err) => {
    console.error("[cron inventory-auto-flows] datos de mercado:", err);
    return 0;
  });
  // Resumen por producto de provedix.com (etapa 2), con lo ya leído.
  const snapshot = await saveProvedixSnapshot().catch((err) => {
    console.error("[cron inventory-auto-flows] resumen provedix:", err);
    return null;
  });
  return NextResponse.json({ ok: true, marketBatches, provedixProducts: snapshot?.products.length ?? null });
}
