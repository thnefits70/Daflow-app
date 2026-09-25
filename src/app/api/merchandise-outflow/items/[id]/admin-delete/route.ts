import { NextResponse } from "next/server";
import { auth } from "@/auth";
import { prisma } from "@/lib/prisma";
import { recordKardexEntry } from "@/lib/stockKardex";

// Confirmado 2026-09-23, pedido de Daniel: EG-0005 (Power Bank + Almohada)
// fueron pruebas de un rechazo del proveedor y le ensuciaban "Gestionados".
// Solo admin, y nunca si el ítem ya movió plata (crédito) o quedó enganchado
// a otro registro — borrarlo ahí dejaría esos otros registros descuadrados.
// Si el lote queda vacío se borra también.
// Ampliado 2026-09-25, pedido de Daniel: EG-0042 (Rodillo para masaje de
// pies, dado de baja) fue una prueba de DETERIORO. Un deterioro cerrado ahí
// mismo (baja o solucionado) sí se puede eliminar: como al reportarlo restó
// el stock, se devuelven esas unidades con una entrada al Kardex.
export async function POST(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const session = await auth();
  if (!session || session.user.role !== "admin") return NextResponse.json({ error: "No autorizado." }, { status: 403 });

  const { id } = await params;
  const item = await prisma.merchandiseOutflowItem.findUnique({
    where: { id },
    select: {
      batchId: true,
      catalogItemId: true,
      resolution: true,
      sourceDeteriorItemId: true,
      sourceReentryItemId: true,
      groupedSupplierCreditId: true,
      batch: { select: { reason: true } },
      credit: { select: { id: true } },
      exchangeItem: { select: { id: true } },
      stockKardexEntry: { select: { id: true, type: true, quantity: true, lotAllocations: { select: { expirationCohortId: true, quantity: true } } } },
    },
  });
  if (!item) return NextResponse.json({ error: "No encontrado." }, { status: 404 });
  const reason = item.batch.reason;
  if (reason !== "CAMBIO_PROVEEDOR" && reason !== "DETERIORO") return NextResponse.json({ error: "Solo se pueden eliminar cambios con proveedor o deterioros." }, { status: 400 });
  if (item.credit || item.groupedSupplierCreditId) return NextResponse.json({ error: "Tiene un crédito del proveedor registrado — no se puede eliminar." }, { status: 409 });
  if (item.sourceReentryItemId) return NextResponse.json({ error: "Está unido a una devolución de cliente — no se puede eliminar." }, { status: 409 });
  if (reason === "CAMBIO_PROVEEDOR") {
    if (item.stockKardexEntry) return NextResponse.json({ error: "Ya movió el stock (Kardex) — no se puede eliminar." }, { status: 409 });
    if (item.sourceDeteriorItemId) return NextResponse.json({ error: "Viene de un reporte de deterioro — no se puede eliminar." }, { status: 409 });
  } else {
    if (item.resolution === "ESCALATED_TO_PURCHASES") return NextResponse.json({ error: "Ya se escaló a Compras — no se puede eliminar." }, { status: 409 });
    if (item.exchangeItem) return NextResponse.json({ error: "Ya está en un paquete de devolución — no se puede eliminar." }, { status: 409 });
  }

  const entry = item.stockKardexEntry;
  await prisma.$transaction(async (tx) => {
    // Lotes de caducidad: la salida los había descontado, se devuelven igual.
    for (const a of entry?.lotAllocations ?? []) {
      await tx.expirationCohort.update({ where: { id: a.expirationCohortId }, data: { quantityRemaining: { increment: a.quantity } } });
    }
    await tx.merchandiseOutflowItem.delete({ where: { id } });
    const left = await tx.merchandiseOutflowItem.count({ where: { batchId: item.batchId } });
    if (left === 0) await tx.merchandiseOutflowBatch.delete({ where: { id: item.batchId } });
  });

  let restoredQty = 0;
  if (entry?.type === "OUT" && item.catalogItemId) {
    try {
      await recordKardexEntry({ catalogItemId: item.catalogItemId, type: "IN", quantity: entry.quantity, unitCost: null, occurredAt: new Date() });
      restoredQty = entry.quantity;
    } catch (err) {
      console.error("[merchandise-outflow admin-delete] No se pudo devolver el stock:", err);
      return NextResponse.json({ ok: true, warning: `Se eliminó, pero no se pudieron devolver ${entry.quantity} un. al stock — súmalas con un ajuste por conteo físico.` });
    }
  }
  return NextResponse.json({ ok: true, restoredQty });
}
