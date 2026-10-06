import { NextResponse } from "next/server";
import { auth } from "@/auth";
import { prisma } from "@/lib/prisma";
import { recordKardexEntry } from "@/lib/stockKardex";

// UN SOLO USO (pedido del usuario 2026-10-06, confirmado por Daniel): el
// Corte 5 del 06-oct contó 30 Mini Proyector (192919) porque la tabla de
// Dropi seguía sumando la guía 189908172, que ya salió el 05-oct. Las guías
// nuevas traían 29 y esa unidad no salió de bodega. Se corrige el corte a
// 29 y se devuelve 1 al Kardex. Borrar esta ruta y la página después de usarla.
const LOT_ID = "cmuwy1u7u000004l3t92fhped";
const ITEM_ID = "cmuwy1udt000204l3cd0h3ss7"; // Servientrega, 10 → 9
const CATALOG_ITEM_ID = "cmuljscxw00090agmrcg4gxzd";

export async function POST() {
  const session = await auth();
  if (!session || session.user.role !== "admin") return NextResponse.json({ error: "No autorizado." }, { status: 403 });

  // Solo si sigue exactamente como estaba (así no se aplica dos veces).
  const [item, pick] = await Promise.all([
    prisma.fulfillmentRequestItem.findUnique({ where: { id: ITEM_ID }, select: { quantity: true, catalogItemId: true, batchId: true, batch: { select: { lotId: true } } } }),
    prisma.fulfillmentLotPick.findUnique({ where: { lotId_catalogItemId: { lotId: LOT_ID, catalogItemId: CATALOG_ITEM_ID } }, select: { pickedQty: true, confirmedQty: true } }),
  ]);
  if (!item || item.batch.lotId !== LOT_ID || item.catalogItemId !== CATALOG_ITEM_ID || !pick) return NextResponse.json({ error: "No encontré el corte o el producto." }, { status: 404 });
  if (item.quantity !== 10 || pick.confirmedQty !== 30) return NextResponse.json({ error: "Ya está corregido (o cambió desde que se revisó) — no se hizo nada." }, { status: 409 });

  const claimed = await prisma.fulfillmentRequestItem.updateMany({ where: { id: ITEM_ID, quantity: 10 }, data: { quantity: 9 } });
  if (claimed.count === 0) return NextResponse.json({ error: "Ya está corregido — no se hizo nada." }, { status: 409 });
  await prisma.fulfillmentLotPick.update({ where: { lotId_catalogItemId: { lotId: LOT_ID, catalogItemId: CATALOG_ITEM_ID } }, data: { pickedQty: 29, confirmedQty: 29 } });
  const entry = await recordKardexEntry({ catalogItemId: CATALOG_ITEM_ID, type: "IN", quantity: 1, unitCost: null, occurredAt: new Date() });
  await prisma.fulfillmentRequestBatch.update({
    where: { id: item.batchId },
    data: {
      parseWarnings: {
        push: `Corrección ${new Date().toLocaleDateString("es-EC", { timeZone: "America/Guayaquil" })} (${session.user.name ?? "admin"}, confirmado por Daniel): Mini Proyector 30 → 29. La tabla de Dropi sumaba la guía 189908172, que ya salió el 05-oct; esa unidad no salió de bodega y se devolvió 1 al stock.`,
      },
    },
  });
  return NextResponse.json({ ok: true, balanceAfter: entry.balanceAfter });
}
