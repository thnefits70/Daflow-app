import { NextResponse } from "next/server";
import { auth } from "@/auth";
import { prisma } from "@/lib/prisma";
import { canCloseMerchandiseReentry } from "@/lib/guards";
import { maybeMarkBatchClosed } from "@/lib/merchandiseReentry";

// Nairoby marca que ya ingresó la parte buena de este producto al sistema
// Just — un clic, mismo patrón que la pestaña Just ya existente en
// recepción normal.
export async function POST(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const session = await auth();
  if (!(await canCloseMerchandiseReentry()) || !session) return NextResponse.json({ error: "No autorizado." }, { status: 403 });

  const { id } = await params;
  const item = await prisma.merchandiseReentryItem.findUnique({
    where: { id },
    include: { batch: { select: { danielApprovedAt: true } } },
  });
  if (!item) return NextResponse.json({ error: "No encontrado." }, { status: 404 });
  if (!item.batch.danielApprovedAt) return NextResponse.json({ error: "Este lote todavía no fue aprobado por Daniel." }, { status: 409 });
  if (item.goodQty <= 0) return NextResponse.json({ error: "Este producto no tiene unidades buenas." }, { status: 409 });
  if (item.justUploadedAt) return NextResponse.json({ error: "Ya estaba marcado como subido a Just." }, { status: 409 });

  const updated = await prisma.merchandiseReentryItem.update({
    where: { id },
    data: { justUploadedAt: new Date(), justUploadedById: session.user.role === "admin" ? null : session.user.id },
  });

  await maybeMarkBatchClosed(item.batchId);
  return NextResponse.json(updated);
}
