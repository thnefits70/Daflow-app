import { NextRequest, NextResponse } from "next/server";
import { canActOnPurchaseReceiving } from "@/lib/guards";
import { prisma } from "@/lib/prisma";

// Confirmado 2026-08-18: pedido explícito del usuario — checklist personal
// de Daniel para pasar al sistema Just todo lo que ya aprobó (recepciones
// normales Y cambios de mercadería aprobados), agrupado por día en el
// cliente. Desaparece de acá apenas marca "Subido a JUSTA" (ver
// mark-justa-uploaded routes) — no se toca nada de esto hasta que él lo
// confirma, es trabajo mecánico suyo, no del equipo.
export async function GET(_req: NextRequest) {
  if (!(await canActOnPurchaseReceiving())) return NextResponse.json({ error: "No autorizado." }, { status: 403 });

  const [receipts, resolutions] = await Promise.all([
    prisma.purchaseRequestReceipt.findMany({
      where: { justaUploadedAt: null, request: { status: "RECEIVED" } },
      orderBy: { approvedAt: "asc" },
      include: {
        request: { select: { id: true, quantity: true, catalogItem: { select: { name: true } }, supplier: { select: { name: true } } } },
      },
    }),
    prisma.purchaseUrgentResolution.findMany({
      where: { type: "REPLACEMENT", status: "COMPLETED", justaUploadedAt: null },
      orderBy: { replacementArrivedAt: "asc" },
      include: {
        report: { include: { request: { select: { catalogItem: { select: { name: true } }, supplier: { select: { name: true } } } } } },
      },
    }),
  ]);

  const items = [
    ...receipts.map((r) => ({
      kind: "receipt" as const,
      id: r.requestId,
      productName: r.request.catalogItem.name,
      supplierName: r.request.supplier.name,
      quantity: r.receivedQuantity,
      approvedAt: r.approvedAt,
    })),
    ...resolutions.map((res) => ({
      kind: "replacement" as const,
      id: res.id,
      productName: res.report.request.catalogItem.name,
      supplierName: res.report.request.supplier.name,
      quantity: res.quantity,
      approvedAt: res.replacementArrivedAt,
    })),
  ].sort((a, b) => new Date(a.approvedAt ?? 0).getTime() - new Date(b.approvedAt ?? 0).getTime());

  return NextResponse.json(items);
}
