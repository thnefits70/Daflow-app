import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { auth } from "@/auth";
import { canConfirmMarketingAdvisor } from "@/lib/guards";
import { canBrandNewIds, getNewIdBrandingBoard } from "@/lib/newIdBranding";

// Confirmado 2026-08-08: sondeado cada cierto tiempo por
// MarketingArrivalAlert.tsx para el aviso + sonido DENTRO de la pantalla
// (además del push del sistema) — Vercel no soporta websockets/SSE
// persistentes en el plan actual, así que esto es sondeo corto, no tiempo
// real de verdad. Devuelve los ids pendientes (no solo un número) para que
// el cliente pueda distinguir cuáles ya vio vs. cuáles son nuevas.
// Confirmado 2026-09-23: para quien brandea (Robert) cuenta los "Nuevos IDs
// por brandear" (uno por producto, solo la primera vez), no cada llegada.
export async function GET() {
  const session = await auth();
  if (!session) return NextResponse.json({ error: "No autorizado." }, { status: 401 });

  const [isDesigner, isAdvisor] = await Promise.all([canBrandNewIds(), canConfirmMarketingAdvisor()]);
  if (!isDesigner && !isAdvisor) return NextResponse.json({ pendingIds: [], newIdIds: [] });

  const [advisorRows, board] = await Promise.all([
    isAdvisor ? prisma.purchaseReceiptFollowUp.findMany({ where: { advisorConfirmedAt: null }, select: { requestId: true } }) : [],
    isDesigner ? getNewIdBrandingBoard() : null,
  ]);

  return NextResponse.json({
    pendingIds: advisorRows.map((r) => r.requestId),
    newIdIds: board ? board.pending.map((e) => e.key) : [],
  });
}
