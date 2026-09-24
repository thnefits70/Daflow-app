import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { auth } from "@/auth";
import { canActOnPurchaseReceiving } from "@/lib/guards";
import { registerGoodUnitsFromUrgentReport } from "@/lib/purchaseReceiptFromReport";

// Confirmado 2026-09-24, pedido de Daniel: respaldo de un clic para los
// reportes urgentes que Daniel aprobó ANTES de que la parte buena se
// registrara sola al aprobar (ej. Kit Pulidor SC-082, Almohada SC-089) —
// registra lo bueno con la evidencia del reporte, sin volver a tomar fotos.
// Exclusivo de Daniel, mismo criterio que approve/route.ts.
export async function POST(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const session = await auth();
  if (!(await canActOnPurchaseReceiving()) || !session) return NextResponse.json({ error: "No autorizado." }, { status: 403 });

  const { id } = await params;
  const report = await prisma.purchaseRequestUrgentReport.findUnique({ where: { id }, select: { requestId: true, reviewedByLeadAt: true } });
  if (!report) return NextResponse.json({ error: "No encontrado." }, { status: 404 });
  if (!report.reviewedByLeadAt) return NextResponse.json({ error: "Primero revisa y aprueba el reporte." }, { status: 409 });

  const isAdmin = session.user.role === "admin";
  const receipt = await registerGoodUnitsFromUrgentReport(report.requestId, { id: session.user.id, isAdmin, isLead: !isAdmin });
  if (!receipt) return NextResponse.json({ error: "No se pudo registrar: ya tiene recepción, todavía no está pagada, o no queda cantidad buena." }, { status: 409 });
  return NextResponse.json(receipt, { status: 201 });
}
