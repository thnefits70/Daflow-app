import { NextResponse } from "next/server";
import { auth } from "@/auth";
import { prisma } from "@/lib/prisma";
import { canCloseMerchandiseReentry } from "@/lib/guards";
import { maybeMarkBatchClosed } from "@/lib/merchandiseReentry";

// Nairoby registra la baja de la parte confirmada como dañada por Daniel —
// esto es lo que queda como registro financiero de mercadería dada de baja.
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
  if (item.damagedQty <= 0 || item.damageConfirmed !== true) {
    return NextResponse.json({ error: "Este producto no tiene daño confirmado por Daniel." }, { status: 409 });
  }
  if (item.writeOffAt) return NextResponse.json({ error: "Ya estaba marcado como dado de baja." }, { status: 409 });

  const updated = await prisma.merchandiseReentryItem.update({
    where: { id },
    data: { writeOffAt: new Date(), writeOffById: session.user.role === "admin" ? null : session.user.id },
  });

  await maybeMarkBatchClosed(item.batchId);
  return NextResponse.json(updated);
}
