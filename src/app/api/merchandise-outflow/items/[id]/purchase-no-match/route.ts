import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { auth } from "@/auth";
import { prisma } from "@/lib/prisma";
import { canManageOutflowPurchaseGestion } from "@/lib/guards";
import { notifyPurchaseExceptionReported, outflowItemDisplayName } from "@/lib/merchandiseOutflow";

const schema = z.object({ note: z.string().trim().min(1, "Explica qué proveedores probaste y por qué crees que no hay respaldo.") });

// Confirmado 2026-09-17, pedido explícito del usuario: si tras probar con el
// proveedor correcto no hay ninguna compra real registrada, Jariel no puede
// cerrar el caso solo — todo trámite queda con INVESTOCK/DAFLOW, nunca en un
// hueco suelto. Pasa como excepción a admin (ver canDecidePurchaseException).
export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const session = await auth();
  if (!session || !(await canManageOutflowPurchaseGestion())) return NextResponse.json({ error: "No autorizado." }, { status: 403 });

  const { id } = await params;
  const body = await req.json().catch(() => null);
  const parsed = schema.safeParse(body);
  if (!parsed.success) return NextResponse.json({ error: parsed.error.issues[0]?.message ?? "Datos inválidos." }, { status: 400 });

  const item = await prisma.merchandiseOutflowItem.findUnique({
    where: { id },
    include: { batch: { select: { reason: true } }, catalogItem: { select: { name: true } }, purchaseGestionSupplier: { select: { name: true } } },
  });
  if (!item) return NextResponse.json({ error: "No encontrado." }, { status: 404 });
  if (item.batch.reason !== "DETERIORO" || item.resolution !== "ESCALATED_TO_PURCHASES") {
    return NextResponse.json({ error: "Este ítem no es un reclamo de deterioro escalado." }, { status: 400 });
  }
  if (item.purchaseResolution) return NextResponse.json({ error: "Este reclamo ya fue resuelto." }, { status: 409 });
  if (item.linkedPurchaseRequestId) return NextResponse.json({ error: "Este reclamo ya está anclado a una compra real." }, { status: 409 });
  if (!item.purchaseGestionSupplierId) return NextResponse.json({ error: "Elige primero un proveedor." }, { status: 400 });
  if (item.purchaseNoMatchReportedAt) return NextResponse.json({ error: "Ya se reportó esta excepción." }, { status: 409 });

  const updated = await prisma.merchandiseOutflowItem.update({
    where: { id },
    data: { purchaseNoMatchReportedAt: new Date(), purchaseNoMatchNote: parsed.data.note, purchaseNoMatchReportedById: session.user.id },
  });

  await notifyPurchaseExceptionReported({
    declaredName: outflowItemDisplayName(item),
    quantity: item.quantity,
    supplierName: item.purchaseGestionSupplier?.name ?? "—",
    note: parsed.data.note,
  }).catch(() => null);

  return NextResponse.json(updated);
}
