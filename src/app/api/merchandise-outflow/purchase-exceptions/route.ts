import { NextResponse } from "next/server";
import { auth } from "@/auth";
import { prisma } from "@/lib/prisma";
import { canDecidePurchaseException } from "@/lib/guards";

// Confirmado 2026-09-17, pedido explícito del usuario: reclamos de deterioro
// que Jariel no pudo anclar a ninguna compra real y quedaron esperando
// decisión de admin — nunca se pierden, siempre terminan acá hasta que
// alguien decida (ver purchase-exception-decide/route.ts).
export async function GET() {
  const session = await auth();
  if (!session || !(await canDecidePurchaseException())) return NextResponse.json({ error: "No autorizado." }, { status: 403 });

  const items = await prisma.merchandiseOutflowItem.findMany({
    where: { purchaseNoMatchReportedAt: { not: null }, purchaseExceptionDecision: null },
    include: {
      catalogItem: { select: { name: true, photos: true, justCode: true } },
      batch: { select: { code: true } },
      purchaseGestionSupplier: { select: { id: true, name: true } },
      purchaseNoMatchReportedBy: { select: { name: true } },
    },
    orderBy: { purchaseNoMatchReportedAt: "asc" },
  });

  return NextResponse.json(items);
}
