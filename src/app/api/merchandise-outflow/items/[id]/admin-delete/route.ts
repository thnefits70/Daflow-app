import { NextResponse } from "next/server";
import { auth } from "@/auth";
import { prisma } from "@/lib/prisma";

// Confirmado 2026-09-23, pedido de Daniel: EG-0005 (Power Bank + Almohada)
// fueron pruebas de un rechazo del proveedor y le ensuciaban "Gestionados".
// Solo admin, solo CAMBIO_PROVEEDOR, y nunca si el ítem ya movió plata
// (crédito) o stock (Kardex) o vino de un deterioro — borrarlo ahí dejaría
// esos otros registros descuadrados. Si el lote queda vacío se borra también.
export async function POST(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const session = await auth();
  if (!session || session.user.role !== "admin") return NextResponse.json({ error: "No autorizado." }, { status: 403 });

  const { id } = await params;
  const item = await prisma.merchandiseOutflowItem.findUnique({
    where: { id },
    select: {
      batchId: true,
      sourceDeteriorItemId: true,
      batch: { select: { reason: true } },
      credit: { select: { id: true } },
      stockKardexEntry: { select: { id: true } },
    },
  });
  if (!item) return NextResponse.json({ error: "No encontrado." }, { status: 404 });
  if (item.batch.reason !== "CAMBIO_PROVEEDOR") return NextResponse.json({ error: "Solo se pueden eliminar cambios con proveedor." }, { status: 400 });
  if (item.credit) return NextResponse.json({ error: "Tiene un crédito del proveedor registrado — no se puede eliminar." }, { status: 409 });
  if (item.stockKardexEntry) return NextResponse.json({ error: "Ya movió el stock (Kardex) — no se puede eliminar." }, { status: 409 });
  if (item.sourceDeteriorItemId) return NextResponse.json({ error: "Viene de un reporte de deterioro — no se puede eliminar." }, { status: 409 });

  await prisma.$transaction(async (tx) => {
    await tx.merchandiseOutflowItem.delete({ where: { id } });
    const left = await tx.merchandiseOutflowItem.count({ where: { batchId: item.batchId } });
    if (left === 0) await tx.merchandiseOutflowBatch.delete({ where: { id: item.batchId } });
  });
  return NextResponse.json({ ok: true });
}
