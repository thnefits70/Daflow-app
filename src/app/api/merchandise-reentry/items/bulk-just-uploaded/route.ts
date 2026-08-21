import { NextResponse } from "next/server";
import { auth } from "@/auth";
import { prisma } from "@/lib/prisma";
import { canCloseMerchandiseReentry } from "@/lib/guards";
import { maybeMarkBatchClosed } from "@/lib/merchandiseReentry";

// Confirma de un solo clic el consolidado de un producto: mismo efecto que
// marcar "Subido a Just" item por item, pero para todas las unidades
// pendientes de ese nombre de producto a la vez (puede abarcar varios lotes
// RM distintos) — ver groupJust en batches/close/route.ts.
export async function POST(req: Request) {
  const session = await auth();
  if (!(await canCloseMerchandiseReentry()) || !session) return NextResponse.json({ error: "No autorizado." }, { status: 403 });

  const body = await req.json().catch(() => null);
  const itemIds: unknown = body?.itemIds;
  if (!Array.isArray(itemIds) || itemIds.length === 0 || !itemIds.every((id) => typeof id === "string")) {
    return NextResponse.json({ error: "Lista de productos inválida." }, { status: 400 });
  }

  const items = await prisma.merchandiseReentryItem.findMany({
    where: { id: { in: itemIds } },
    include: { batch: { select: { danielApprovedAt: true } } },
  });
  if (items.length !== itemIds.length) return NextResponse.json({ error: "Algún producto ya no existe." }, { status: 404 });
  for (const item of items) {
    if (!item.batch.danielApprovedAt) return NextResponse.json({ error: "Hay un lote que todavía no fue aprobado por Daniel." }, { status: 409 });
    if (item.goodQty <= 0) return NextResponse.json({ error: "Hay un producto sin unidades buenas." }, { status: 409 });
    if (item.justUploadedAt) return NextResponse.json({ error: "Ya estaba marcado como subido a Just." }, { status: 409 });
  }

  await prisma.merchandiseReentryItem.updateMany({
    where: { id: { in: itemIds } },
    data: { justUploadedAt: new Date(), justUploadedById: session.user.role === "admin" ? null : session.user.id },
  });

  const batchIds = [...new Set(items.map((i) => i.batchId))];
  for (const batchId of batchIds) await maybeMarkBatchClosed(batchId);

  return NextResponse.json({ ok: true });
}
