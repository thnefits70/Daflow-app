import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { auth } from "@/auth";
import { canSubmitPurchaseRequests } from "@/lib/guards";
import { getPurchaseLinesLeftBehind } from "@/lib/purchases";

// Pedido de Jariel 2026-10-05 (caso candado de Zheng wu): para lo que no
// llegó con el resto del pedido, quien coordina con el proveedor abre el
// reclamo por todo lo pedido. Crea el reporte urgente ya revisado (Inventario
// no contó nada, no hay qué revisar), así entra a la bandeja de siempre y se
// resuelve con los mismos botones: crédito a favor, devolución del dinero o
// que el proveedor lo envíe. Mismo patrón que short-receipt-claim.
export async function POST(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const session = await auth();
  const isAdmin = session?.user.role === "admin";
  if (!session || (!isAdmin && !(await canSubmitPurchaseRequests()))) {
    return NextResponse.json({ error: "No autorizado." }, { status: 403 });
  }

  const { id } = await params;
  const line = (await getPurchaseLinesLeftBehind()).find((l) => l.id === id);
  if (!line) {
    return NextResponse.json({ error: "Esta compra ya se recibió o ya tiene un reclamo abierto." }, { status: 409 });
  }

  const since = line.since.toLocaleDateString("es-EC", { day: "numeric", month: "short", timeZone: "America/Guayaquil" });
  const report = await prisma.purchaseRequestUrgentReport.create({
    data: {
      requestId: id,
      missingQty: line.quantity,
      description: `No llegó con el resto del pedido: el ${since} se recibió lo demás y de esto no llegó nada (${line.quantity} un.).`,
      mediaUrls: [],
      reportedById: isAdmin ? null : session.user.id,
      reviewedByLeadAt: new Date(),
    },
  });
  return NextResponse.json(report, { status: 201 });
}
