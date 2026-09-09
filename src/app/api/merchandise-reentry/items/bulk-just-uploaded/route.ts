import { NextResponse } from "next/server";
import { auth } from "@/auth";
import { prisma } from "@/lib/prisma";
import { canManageJustUpload } from "@/lib/guards";
import { maybeMarkBatchClosed, JUST_UPLOAD_MIN_QTY, isTodayLastBusinessDayOfWeek } from "@/lib/merchandiseReentry";
import { recordKardexEntry } from "@/lib/stockKardex";

// Confirma de un solo clic el consolidado de un producto: mismo efecto que
// marcar "Subido a Just" item por item, pero para todas las unidades
// pendientes de ese nombre de producto a la vez (puede abarcar varios lotes
// RM distintos) — ver groupJust en batches/close/route.ts.
export async function POST(req: Request) {
  const session = await auth();
  if (!(await canManageJustUpload()) || !session) return NextResponse.json({ error: "No autorizado." }, { status: 403 });

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

  // Confirmado 2026-08-23: los grupos de JUST_UPLOAD_MIN_QTY unidades o
  // menos solo se pueden subir el último día laboral de la semana — se
  // valida acá también, no solo ocultando el botón en el cliente.
  // Corregido 2026-09-07: igual que en batches/close/route.ts, una vez que
  // el ítem se habilitó (justEligibleOpenedAt) se queda habilitado aunque
  // ya no sea el último día laboral — si no, esta ruta rechazaba subidas
  // que el listado (GET) ya mostraba como permitidas.
  const totalGoodQty = items.reduce((s, i) => s + i.goodQty, 0);
  const alreadyOpened = items.some((i) => i.justEligibleOpenedAt);
  if (totalGoodQty <= JUST_UPLOAD_MIN_QTY && !isTodayLastBusinessDayOfWeek() && !alreadyOpened) {
    return NextResponse.json({ error: `Este producto tiene ${JUST_UPLOAD_MIN_QTY} unidades o menos — solo se puede subir a Just el último día laboral de la semana.` }, { status: 409 });
  }

  await prisma.merchandiseReentryItem.updateMany({
    where: { id: { in: itemIds } },
    data: { justUploadedAt: new Date(), justUploadedById: session.user.id },
  });

  // Confirmado 2026-09-09 (Fase 3, INVESTOCK): este es el momento real en que
  // la mercadería vuelve a stock (parte buena subida a Just) — mismo patrón
  // que el resto de entradas/salidas del Kardex. Ítems sin catalogItemId
  // (declarados solo por nombre) no tienen a qué producto sumarle, se omiten.
  // Secuencial, no en paralelo, porque cada línea depende del saldo que dejó
  // la anterior del mismo producto.
  for (const item of items) {
    if (!item.catalogItemId) continue;
    await recordKardexEntry({
      catalogItemId: item.catalogItemId,
      type: "IN",
      quantity: item.goodQty,
      unitCost: null,
      occurredAt: new Date(),
    }).catch((err) => console.error("[merchandise-reentry bulk-just-uploaded] No se pudo registrar la entrada de Kardex:", err));
  }

  const batchIds = [...new Set(items.map((i) => i.batchId))];
  for (const batchId of batchIds) await maybeMarkBatchClosed(batchId);

  return NextResponse.json({ ok: true });
}
