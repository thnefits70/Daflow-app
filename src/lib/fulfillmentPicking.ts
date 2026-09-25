import { prisma } from "@/lib/prisma";
import { recordKardexEntry } from "@/lib/stockKardex";
import { notifyOwner } from "@/lib/notifications";
import { getFulfilmentLeadId } from "@/lib/guards";
import { formatMerchandiseOutflowCode, nextMerchandiseOutflowNumber } from "@/lib/merchandiseOutflow";
import { getCompiledLot, manifestCode } from "@/lib/fulfillmentGuides";
import { recomputeAutoFillRate } from "@/lib/autoFillRate";

// Parte 3 del plan acordado con el usuario 2026-09-23:
//   - Joel y Scott escanean UNA vez el QR de la percha y escriben cuántos
//     sacaron (pueden corregir hasta que Daniel confirme).
//   - Daniel compara lo pedido vs lo sacado y confirma con doble clic: lo
//     que cuadra de una vez; lo que no, uno por uno.
//   - Recién al confirmar se descuenta del Kardex de INVESTOCK, SOLO lo que
//     salió (nunca más de lo pedido), registrado como un Egreso normal
//     (DESPACHO o GARANTIA) para que historial y reportes lo vean igual.
//   - Cuando todo el corte está confirmado se cierra, y lo que faltó le
//     llega a Yair y a Bryan Ríos en un solo aviso.

type Result = { ok: true } | { ok: false; error: string };

const LOT_URL = "/area/workspace?tab=egresos&otab=solicitud";

export async function recordPick(params: { lotId: string; catalogItemId: string; quantity: number; userId: string | null }): Promise<Result> {
  const lot = await getCompiledLot(params.lotId);
  if (!lot) return { ok: false, error: "No encontrado." };
  if (lot.status !== "SENT") return { ok: false, error: lot.status === "DRAFT" ? "Yair todavía no envía este corte." : "Este corte ya se cerró." };
  const line = lot.picking.find((p) => p.catalogItemId === params.catalogItemId);
  if (!line) return { ok: false, error: "Este producto no está en el manifiesto de este corte." };
  if (line.confirmedAt) return { ok: false, error: "Daniel ya confirmó este producto — ya no se puede cambiar." };
  if (!Number.isInteger(params.quantity) || params.quantity < 0) return { ok: false, error: "Cantidad inválida." };

  await prisma.fulfillmentLotPick.upsert({
    where: { lotId_catalogItemId: { lotId: params.lotId, catalogItemId: params.catalogItemId } },
    create: { lotId: params.lotId, catalogItemId: params.catalogItemId, pickedQty: params.quantity, pickedById: params.userId },
    update: { pickedQty: params.quantity, pickedById: params.userId, pickedAt: new Date() },
  });
  return { ok: true };
}

// Un Egreso (EG-xxxx) por corte y por motivo — se crea la primera vez que
// Daniel confirma algo de ese motivo, y las siguientes confirmaciones
// agregan ítems al mismo.
async function outflowBatchFor(lotId: string, reason: "DESPACHO" | "GARANTIA", userId: string | null): Promise<string> {
  const field = reason === "DESPACHO" ? "despachoOutflowBatchId" : "garantiaOutflowBatchId";
  const lot = await prisma.fulfillmentLot.findUnique({ where: { id: lotId }, select: { despachoOutflowBatchId: true, garantiaOutflowBatchId: true } });
  const existing = lot?.[field];
  if (existing) return existing;
  const batchNumber = await nextMerchandiseOutflowNumber();
  const batch = await prisma.merchandiseOutflowBatch.create({
    data: { code: formatMerchandiseOutflowCode(batchNumber), batchNumber, reason, createdById: userId, submittedAt: new Date(), documentPhotoUrls: [] },
    select: { id: true },
  });
  const claimed = await prisma.fulfillmentLot.updateMany({ where: { id: lotId, [field]: null }, data: { [field]: batch.id } });
  if (claimed.count === 0) {
    // Otra confirmación simultánea ya creó el suyo — se usa ese.
    await prisma.merchandiseOutflowBatch.delete({ where: { id: batch.id } });
    const again = await prisma.fulfillmentLot.findUnique({ where: { id: lotId }, select: { despachoOutflowBatchId: true, garantiaOutflowBatchId: true } });
    return again![field]!;
  }
  return batch.id;
}

async function discount(params: { lotId: string; reason: "DESPACHO" | "GARANTIA"; catalogItemId: string; name: string; quantity: number; userId: string | null }) {
  if (params.quantity <= 0) return;
  const batchId = await outflowBatchFor(params.lotId, params.reason, params.userId);
  const item = await prisma.merchandiseOutflowItem.create({
    data: { batchId, catalogItemId: params.catalogItemId, declaredName: params.name, quantity: params.quantity },
    select: { id: true },
  });
  try {
    await recordKardexEntry({
      catalogItemId: params.catalogItemId,
      type: "OUT",
      quantity: params.quantity,
      unitCost: null,
      occurredAt: new Date(),
      merchandiseOutflowItemId: item.id,
    });
  } catch (e) {
    // Sin Kardex no hay egreso: se borra el ítem para no dejar una salida
    // registrada que nunca descontó stock.
    await prisma.merchandiseOutflowItem.delete({ where: { id: item.id } }).catch(() => null);
    throw e;
  }
}

// Daniel confirma uno o varios productos. `onlyMatching`: el botón
// "Confirmar todo lo que cuadra" — si alguno ya no cuadra (los chicos lo
// corrigieron justo antes), ese se salta y queda para confirmarlo aparte.
export async function confirmPicks(params: { lotId: string; catalogItemIds: string[]; onlyMatching: boolean; userId: string | null }): Promise<Result & { confirmed?: number }> {
  const lot = await getCompiledLot(params.lotId);
  if (!lot) return { ok: false, error: "No encontrado." };
  if (lot.status !== "SENT") return { ok: false, error: "Este corte no está abierto para confirmar." };

  let confirmed = 0;
  for (const id of params.catalogItemIds) {
    const line = lot.picking.find((p) => p.catalogItemId === id);
    if (!line || line.confirmedAt) continue;
    const picked = line.picked ?? 0;
    if (params.onlyMatching && picked !== line.needed) continue;
    // Nunca más de lo pedido: si sacaron de más, lo extra vuelve a la percha.
    const qty = Math.min(picked, line.needed);

    // Se marca primero (una sola vez, aunque Daniel haga doble clic
    // rápido) y recién después se descuenta.
    await prisma.fulfillmentLotPick.upsert({
      where: { lotId_catalogItemId: { lotId: params.lotId, catalogItemId: id } },
      create: { lotId: params.lotId, catalogItemId: id, pickedQty: 0, confirmedQty: 0, confirmedAt: new Date(), confirmedById: params.userId },
      update: {},
    });
    const claimed = await prisma.fulfillmentLotPick.updateMany({
      where: { lotId: params.lotId, catalogItemId: id, confirmedAt: null },
      data: { confirmedQty: qty, confirmedAt: new Date(), confirmedById: params.userId },
    });
    // Si el upsert de arriba acaba de crear la fila (nadie escaneó nada),
    // ya quedó confirmada en 0 — no hay nada que descontar.
    if (claimed.count === 0) {
      if (line.picked === null) confirmed++;
      continue;
    }

    // Primero lo del despacho normal, lo que sobre va a garantías.
    const despacho = Math.min(qty, line.normalNeeded);
    const garantia = Math.min(qty - despacho, line.warrantyNeeded);
    try {
      await discount({ lotId: params.lotId, reason: "DESPACHO", catalogItemId: id, name: line.name, quantity: despacho, userId: params.userId });
    } catch (e) {
      console.error("[fulfillment confirm] No se pudo descontar del Kardex:", e);
      // Nada se descontó: el producto vuelve a quedar sin confirmar para
      // que Daniel lo intente de nuevo.
      await prisma.fulfillmentLotPick.updateMany({ where: { lotId: params.lotId, catalogItemId: id }, data: { confirmedQty: null, confirmedAt: null, confirmedById: null } });
      return { ok: false, error: `No se pudo descontar "${line.name}" del Kardex — vuelve a intentarlo.` };
    }
    try {
      await discount({ lotId: params.lotId, reason: "GARANTIA", catalogItemId: id, name: line.name, quantity: garantia, userId: params.userId });
    } catch (e) {
      // El despacho ya se descontó; solo la parte de garantía falló — se
      // deja confirmado (no se puede deshacer la salida ya hecha) y se avisa.
      console.error("[fulfillment confirm] No se pudo descontar la garantía del Kardex:", e);
      return { ok: false, error: `"${line.name}": se descontó el despacho pero no la parte de garantía (${garantia}). Avísale al administrador.` };
    }
    confirmed++;
  }

  await maybeCloseLot(params.lotId);
  return { ok: true, confirmed };
}

// Garantía de solo una pieza: sale del stock de repuestos (confirmado por
// el usuario) — queda registrada en el Egreso de GARANTIA sin producto
// vinculado, así nunca descuenta el Kardex del producto.
export async function confirmWarrantyPiece(params: { lotId: string; itemId: string; userId: string | null }): Promise<Result> {
  const item = await prisma.fulfillmentRequestItem.findUnique({
    where: { id: params.itemId },
    select: { quantity: true, warrantyMode: true, warrantyPiece: true, warrantyGuide: true, pieceConfirmedAt: true, catalogItem: { select: { name: true } }, batch: { select: { lotId: true, lot: { select: { status: true } } } } },
  });
  if (!item || item.batch.lotId !== params.lotId || item.warrantyMode !== "PIECE") return { ok: false, error: "No encontrado." };
  if (item.batch.lot?.status !== "SENT") return { ok: false, error: "Este corte no está abierto para confirmar." };
  const claimed = await prisma.fulfillmentRequestItem.updateMany({ where: { id: params.itemId, pieceConfirmedAt: null }, data: { pieceConfirmedAt: new Date(), pieceConfirmedById: params.userId } });
  if (claimed.count > 0) {
    const batchId = await outflowBatchFor(params.lotId, "GARANTIA", params.userId);
    await prisma.merchandiseOutflowItem.create({
      data: { batchId, catalogItemId: null, declaredName: `Pieza "${item.warrantyPiece}" de ${item.catalogItem.name} (guía ${item.warrantyGuide})`, quantity: item.quantity },
    });
  }
  await maybeCloseLot(params.lotId);
  return { ok: true };
}

async function maybeCloseLot(lotId: string) {
  const lot = await getCompiledLot(lotId);
  if (!lot || lot.status !== "SENT") return;
  // Fill Rate automático (desde 2026-W40): cada confirmación actualiza la
  // falta de stock de la semana. Nunca frena la confirmación si falla.
  await recomputeAutoFillRate(lot.day).catch((e) => console.error("[fill rate auto]", e));
  const pending = lot.picking.some((p) => !p.confirmedAt) || lot.warranty.some((w) => w.mode === "PIECE" && !w.pieceConfirmedAt);
  if (pending) return;
  const closed = await prisma.fulfillmentLot.updateMany({ where: { id: lotId, status: "SENT" }, data: { status: "CLOSED", closedAt: new Date() } });
  if (closed.count === 0) return;

  const missing = lot.picking.filter((p) => (p.confirmedQty ?? 0) < p.needed);
  if (missing.length === 0) return;
  const label = `${lot.manifestNumber ? `${manifestCode(lot.manifestNumber)} · ` : ""}Corte ${lot.corte} del ${lot.day.split("-").reverse().join("/")}`;
  const list = missing
    .slice(0, 8)
    .map((m) => `${m.name} (salieron ${m.confirmedQty ?? 0} de ${m.needed})`)
    .join("; ");
  const more = missing.length > 8 ? ` y ${missing.length - 8} más` : "";
  const body = `${label}: faltaron unidades — ${list}${more}.`;

  // Yair (para saber qué pedidos no salen) y Bryan Ríos (para organizar con
  // Jariel la compra o la solución) — confirmado por el usuario.
  const recipients = new Set<string>();
  const yair = await getFulfilmentLeadId();
  if (yair) recipients.add(yair);
  const approvers = await prisma.user.findMany({ where: { isActive: true, canApprovePurchaseRequests: true }, select: { id: true } });
  for (const a of approvers) recipients.add(a.id);
  for (const id of recipients) {
    await notifyOwner(id, { title: "Faltaron productos en el despacho", body, url: LOT_URL });
  }
}
