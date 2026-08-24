import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { auth } from "@/auth";
import { prisma } from "@/lib/prisma";
import { canActOnMerchandiseReentry, canCaptureMerchandiseReentry } from "@/lib/guards";
import { itemNeedsReview, maybeMarkBatchApproved } from "@/lib/merchandiseReentry";

const schema = z.union([z.object({ catalogItemId: z.string().min(1) }), z.object({ manualName: z.string().trim().min(1).max(200) })]);

// Confirmado 2026-08-23 (pedido explícito del usuario): la vinculación de un
// producto de reingreso a un producto del catálogo se puede corregir en dos
// momentos distintos, con reglas distintas:
// 1. Mientras el lote sigue en borrador (no enviado) — solo quien lo creó
//    puede desvincular/volver a vincular las veces que quiera, sin tocar
//    ninguna lógica de aprobación (Daniel todavía no entra en juego).
// 2. Después de enviado — exclusivo de Daniel, y SOLO mientras el item
//    todavía no fue aprobado. Una vez aprobado, el vínculo queda fijo para
//    siempre — ni Inventario ni Daniel pueden volver a tocarlo (pedido
//    explícito: "ya no debe existir forma de que se desvincule").
export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const session = await auth();
  if (!session) return NextResponse.json({ error: "No autorizado." }, { status: 403 });

  const { id } = await params;
  const body = await req.json().catch(() => null);
  const parsed = schema.safeParse(body);
  if (!parsed.success) return NextResponse.json({ error: "Datos inválidos." }, { status: 400 });

  const item = await prisma.merchandiseReentryItem.findUnique({
    where: { id },
    include: { batch: { select: { id: true, createdById: true, submittedAt: true } } },
  });
  if (!item) return NextResponse.json({ error: "No encontrado." }, { status: 404 });

  let catalogItemId: string | null = null;
  let manualName: string | null = null;
  if ("catalogItemId" in parsed.data) {
    const catalogItem = await prisma.purchaseCatalogItem.findUnique({ where: { id: parsed.data.catalogItemId }, select: { id: true } });
    if (!catalogItem) return NextResponse.json({ error: "Producto no encontrado." }, { status: 404 });
    catalogItemId = catalogItem.id;
  } else {
    manualName = parsed.data.manualName;
  }

  if (!item.batch.submittedAt) {
    if (!(await canCaptureMerchandiseReentry()) || item.batch.createdById !== session.user.id) {
      return NextResponse.json({ error: "No autorizado." }, { status: 403 });
    }
    const updated = await prisma.merchandiseReentryItem.update({
      where: { id },
      data: catalogItemId
        ? { catalogItemId, aiRecognized: true, declaredName: null, correctedName: null }
        : { catalogItemId: null, aiRecognized: false, declaredName: manualName, correctedName: null },
    });
    return NextResponse.json(updated);
  }

  if (!(await canActOnMerchandiseReentry())) return NextResponse.json({ error: "No autorizado." }, { status: 403 });
  if (item.approvedAt) return NextResponse.json({ error: "Este producto ya fue aprobado — el vínculo queda fijo." }, { status: 409 });

  const correctedName = catalogItemId ? null : manualName;
  const stillNeedsReview = itemNeedsReview({ aiRecognized: !!catalogItemId, damagedQty: item.damagedQty, correctedName, damageConfirmed: item.damageConfirmed });

  const updated = await prisma.merchandiseReentryItem.update({
    where: { id },
    data: {
      catalogItemId,
      aiRecognized: !!catalogItemId,
      correctedName,
      correctedById: session.user.id,
      correctedAt: new Date(),
      ...(stillNeedsReview ? {} : { approvedAt: item.approvedAt ?? new Date(), approvedById: item.approvedById ?? session.user.id }),
    },
  });

  await maybeMarkBatchApproved(item.batch.id);
  return NextResponse.json(updated);
}
