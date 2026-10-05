import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { auth } from "@/auth";
import { canSubmitPurchaseRequests } from "@/lib/guards";

// Pedido del usuario 2026-10-05 (caso Bolsa De Lavar Zapatos): quien
// coordina con el proveedor (hoy Jariel) abre el reclamo de un faltante que
// llegó corto y nunca se reportó. Crea el reporte urgente ya revisado (el
// conteo de Inventario ya existe en la recepción, Daniel no tiene nada
// nuevo que revisar), así entra a la bandeja de siempre y se resuelve con
// los mismos botones (crédito, reembolso, entrega del faltante, sin stock).
export async function POST(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const session = await auth();
  const isAdmin = session?.user.role === "admin";
  if (!session || (!isAdmin && !(await canSubmitPurchaseRequests()))) {
    return NextResponse.json({ error: "No autorizado." }, { status: 403 });
  }

  const { id } = await params;
  const existing = await prisma.purchaseRequest.findUnique({
    where: { id },
    select: { quantity: true, status: true, receipt: { select: { receivedQuantity: true, confirmedAt: true } }, urgentReports: { select: { id: true } } },
  });
  if (!existing) return NextResponse.json({ error: "No encontrada." }, { status: 404 });
  if (!existing.receipt || !["RECEIVED", "RECEIVED_PENDING_REVIEW"].includes(existing.status)) {
    return NextResponse.json({ error: "Esta compra todavía no tiene recepción." }, { status: 409 });
  }
  if (existing.urgentReports.length > 0) return NextResponse.json({ error: "Esta compra ya tiene un reclamo abierto." }, { status: 409 });
  const missing = existing.quantity - existing.receipt.receivedQuantity;
  if (missing <= 0) return NextResponse.json({ error: "Llegó completa, no hay faltante." }, { status: 409 });

  const receivedOn = existing.receipt.confirmedAt
    ? existing.receipt.confirmedAt.toLocaleDateString("es-EC", { day: "numeric", month: "short", timeZone: "America/Guayaquil" })
    : "la recepción";
  const now = new Date();
  const report = await prisma.purchaseRequestUrgentReport.create({
    data: {
      requestId: id,
      missingQty: missing,
      description: `Faltante sin reclamar: en la recepción del ${receivedOn} se contaron ${existing.receipt.receivedQuantity} de ${existing.quantity} un.`,
      mediaUrls: [],
      reportedById: isAdmin ? null : session.user.id,
      reviewedByLeadAt: now,
    },
  });
  return NextResponse.json(report, { status: 201 });
}
