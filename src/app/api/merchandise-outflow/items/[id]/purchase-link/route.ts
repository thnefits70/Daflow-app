import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { auth } from "@/auth";
import { prisma } from "@/lib/prisma";
import { canManageOutflowPurchaseGestion } from "@/lib/guards";
import { findMostRecentSupplierPurchase } from "@/lib/merchandiseOutflow";

const schema = z.object({ supplierId: z.string().min(1) });

// Confirmado 2026-09-17, pedido explícito del usuario: quien gestiona
// (Jariel) elige el proveedor A MANO — nunca se ancla solo, para no acusar a
// un proveedor que no vendió esa mercadería. Al elegirlo, se busca la ÚLTIMA
// compra REAL (mismo criterio que CAMBIO_PROVEEDOR, ver
// findMostRecentSupplierPurchase) a ESE proveedor de ESE producto. Si se
// encuentra, el reclamo queda anclado (linkedPurchaseRequestId +
// unitCostAtExchange + expectedCreditAmount, mismos campos que ya usa
// CAMBIO_PROVEEDOR) y ya se puede resolver. Si no se encuentra, no se ancla
// nada — Jariel puede probar con otro proveedor o reportar que no hay
// respaldo (ver purchase-no-match/route.ts).
export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const session = await auth();
  if (!session || !(await canManageOutflowPurchaseGestion())) return NextResponse.json({ error: "No autorizado." }, { status: 403 });

  const { id } = await params;
  const body = await req.json().catch(() => null);
  const parsed = schema.safeParse(body);
  if (!parsed.success) return NextResponse.json({ error: "Falta el proveedor." }, { status: 400 });

  const item = await prisma.merchandiseOutflowItem.findUnique({
    where: { id },
    include: { batch: { select: { reason: true } } },
  });
  if (!item) return NextResponse.json({ error: "No encontrado." }, { status: 404 });
  if (item.batch.reason !== "DETERIORO" || item.resolution !== "ESCALATED_TO_PURCHASES") {
    return NextResponse.json({ error: "Este ítem no es un reclamo de deterioro escalado." }, { status: 400 });
  }
  if (item.purchaseResolution) return NextResponse.json({ error: "Este reclamo ya fue resuelto." }, { status: 409 });
  if (!item.catalogItemId) return NextResponse.json({ error: "Este producto no está vinculado al catálogo." }, { status: 400 });

  const supplier = await prisma.supplier.findUnique({ where: { id: parsed.data.supplierId }, select: { id: true, name: true } });
  if (!supplier) return NextResponse.json({ error: "Proveedor no encontrado." }, { status: 404 });

  const lastPurchase = await findMostRecentSupplierPurchase(supplier.id, item.catalogItemId);

  const updated = await prisma.merchandiseOutflowItem.update({
    where: { id },
    data: {
      purchaseGestionSupplierId: supplier.id,
      linkedPurchaseRequestId: lastPurchase?.purchaseRequestId ?? null,
      unitCostAtExchange: lastPurchase?.unitCost ?? null,
      expectedCreditAmount: lastPurchase ? lastPurchase.unitCost * item.quantity : null,
      // Un intento nuevo con otro proveedor reabre la posibilidad de
      // encontrar respaldo — limpia cualquier "sin respaldo" previo de un
      // proveedor distinto que se haya probado antes.
      purchaseNoMatchReportedAt: null,
      purchaseNoMatchNote: null,
      purchaseNoMatchReportedById: null,
    },
    include: {
      catalogItem: { select: { name: true, photos: true, justCode: true } },
      purchaseGestionSupplier: { select: { id: true, name: true } },
      linkedPurchaseRequest: { select: { requestNumber: true, requestedAt: true, quantity: true, unitCost: true } },
    },
  });

  return NextResponse.json({ found: !!lastPurchase, item: updated });
}
