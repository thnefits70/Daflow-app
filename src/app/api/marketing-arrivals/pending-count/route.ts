import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { auth } from "@/auth";
import { canConfirmMarketingDesign, canConfirmMarketingAdvisor } from "@/lib/guards";

// Confirmado 2026-08-08: sondeado cada cierto tiempo por
// MarketingArrivalAlert.tsx para el aviso + sonido DENTRO de la pantalla
// (además del push del sistema) — Vercel no soporta websockets/SSE
// persistentes en el plan actual, así que esto es sondeo corto, no tiempo
// real de verdad. Devuelve los ids pendientes (no solo un número) para que
// el cliente pueda distinguir cuáles ya vio vs. cuáles son nuevas.
export async function GET() {
  const session = await auth();
  if (!session) return NextResponse.json({ error: "No autorizado." }, { status: 401 });

  const [isDesigner, isAdvisor] = await Promise.all([canConfirmMarketingDesign(), canConfirmMarketingAdvisor()]);
  if (!isDesigner && !isAdvisor) return NextResponse.json({ pendingIds: [] });

  const rows = await prisma.purchaseReceiptFollowUp.findMany({
    where: {
      OR: [
        ...(isDesigner ? [{ designConfirmedAt: null }] : []),
        ...(isAdvisor ? [{ advisorConfirmedAt: null }] : []),
      ],
    },
    select: { requestId: true },
  });

  return NextResponse.json({ pendingIds: rows.map((r) => r.requestId) });
}
