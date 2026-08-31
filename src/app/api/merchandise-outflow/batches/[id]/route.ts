import { NextResponse } from "next/server";
import { auth } from "@/auth";
import { prisma } from "@/lib/prisma";
import { canCaptureMerchandiseOutflow, canActOnMerchandiseOutflow } from "@/lib/guards";

// Eliminar el lote entero (y sus productos, por cascada) — solo mientras
// sigue en borrador y solo quien lo creó. CAMBIO_PROVEEDOR y DESPACHO
// (confirmado 2026-08-31) exclusivos de Daniel, igual que el resto de
// acciones de esos motivos.
export async function DELETE(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const session = await auth();
  if (!session) return NextResponse.json({ error: "No autorizado." }, { status: 403 });

  const { id } = await params;
  const batch = await prisma.merchandiseOutflowBatch.findUnique({
    where: { id },
    select: { createdById: true, submittedAt: true, reason: true, batchNumber: true, _count: { select: { items: true } } },
  });
  if (!batch) return NextResponse.json({ error: "No encontrado." }, { status: 404 });
  const authorized = batch.reason === "CAMBIO_PROVEEDOR" || batch.reason === "DESPACHO" ? await canActOnMerchandiseOutflow() : await canCaptureMerchandiseOutflow();
  if (!authorized) return NextResponse.json({ error: "No autorizado." }, { status: 403 });
  if (batch.createdById !== session.user.id) return NextResponse.json({ error: "No autorizado." }, { status: 403 });
  if (batch.submittedAt) return NextResponse.json({ error: "Este lote ya fue enviado — no se puede eliminar." }, { status: 409 });

  await prisma.merchandiseOutflowBatch.delete({ where: { id } });

  // Confirmado 2026-08-26 (pedido explícito del usuario): un lote cancelado
  // sin productos se borra ENTERO y no queda marcado en ningún lado (a
  // diferencia de una factura anulada) — el número no sirve de auditoría,
  // así que conviene reutilizarlo en vez de dejar huecos. Solo se reclama
  // si el contador global sigue exactamente en este número (nadie más creó
  // otro lote de CUALQUIER motivo mientras tanto — comparten el mismo
  // correlativo EG-); si alguien más ya lo avanzó, se deja el hueco en vez
  // de arriesgar un número repetido.
  if (batch._count.items === 0) {
    await prisma.platformSettings.updateMany({
      where: { id: "singleton", lastMerchandiseOutflowNumber: batch.batchNumber },
      data: { lastMerchandiseOutflowNumber: { decrement: 1 } },
    });
  }

  return NextResponse.json({ ok: true });
}
