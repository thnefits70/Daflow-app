import { NextResponse } from "next/server";
import { auth } from "@/auth";
import { prisma } from "@/lib/prisma";
import { canCaptureMerchandiseOutflow, canActOnMerchandiseOutflow } from "@/lib/guards";
import { notifyInventoryLeadOutflowPending, notifySupplierExchangeGestors } from "@/lib/merchandiseOutflow";

const MIN_DOCUMENT_PHOTOS_BY_REASON: Partial<Record<string, number>> = { CAMBIO_PROVEEDOR: 1 };

// Congela el lote — a partir de acá ya no se puede editar, y queda listo en
// la cola de "dar de baja en Just". CAMBIO_PROVEEDOR además exige al menos
// una foto de la lista física declarada (documentPhotoUrls) como evidencia
// de lo que se metió al paquete.
export async function POST(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const session = await auth();
  if (!session) return NextResponse.json({ error: "No autorizado." }, { status: 403 });

  const { id } = await params;
  const batch = await prisma.merchandiseOutflowBatch.findUnique({ where: { id }, include: { items: { select: { id: true } } } });
  if (!batch) return NextResponse.json({ error: "No encontrado." }, { status: 404 });
  const authorized = batch.reason === "CAMBIO_PROVEEDOR" ? await canActOnMerchandiseOutflow() : await canCaptureMerchandiseOutflow();
  if (!authorized) return NextResponse.json({ error: "No autorizado." }, { status: 403 });
  if (batch.createdById !== session.user.id) return NextResponse.json({ error: "No autorizado." }, { status: 403 });
  if (batch.submittedAt) return NextResponse.json({ error: "Este lote ya fue enviado." }, { status: 409 });
  if (batch.items.length === 0) return NextResponse.json({ error: "Agrega al menos un producto antes de enviar." }, { status: 409 });
  const minPhotos = MIN_DOCUMENT_PHOTOS_BY_REASON[batch.reason] ?? 0;
  if (batch.documentPhotoUrls.length < minPhotos) {
    return NextResponse.json({ error: "Toma al menos una foto de la lista de productos antes de enviar." }, { status: 409 });
  }

  const updated = await prisma.merchandiseOutflowBatch.update({ where: { id }, data: { submittedAt: new Date() } });
  await notifyInventoryLeadOutflowPending(updated);
  if (updated.reason === "CAMBIO_PROVEEDOR") {
    const withDetails = await prisma.merchandiseOutflowBatch.findUnique({
      where: { id },
      include: {
        supplier: { select: { name: true } },
        items: { include: { catalogItem: { select: { name: true } }, linkedPurchaseRequest: { select: { requestedById: true } } } },
      },
    });
    if (withDetails) await notifySupplierExchangeGestors(withDetails);
  }
  return NextResponse.json(updated);
}
