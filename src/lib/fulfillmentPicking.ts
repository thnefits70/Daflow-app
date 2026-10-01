import { prisma } from "@/lib/prisma";
import { recordKardexEntry } from "@/lib/stockKardex";
import { notifyOwner } from "@/lib/notifications";
import { formatMerchandiseOutflowCode, nextMerchandiseOutflowNumber } from "@/lib/merchandiseOutflow";
import { getCompiledLot, isBackfillLot, manifestCode, purchaseDeciderIds } from "@/lib/fulfillmentGuides";
import { recomputeAutoFillRate } from "@/lib/autoFillRate";
import { carrierLabel } from "@/lib/carriers";
import { getInventoryLeadId } from "@/lib/guards";
import { computeGuideHolds, holdSummary } from "@/lib/fulfillmentHolds";

// Parte 3 del plan acordado con el usuario 2026-09-23:
//   - Joel y Scott escanean UNA vez el QR de la percha y escriben cuántos
//     sacaron (pueden corregir hasta que Daniel confirme).
//   - Daniel compara lo pedido vs lo sacado y confirma con doble clic: lo
//     que cuadra de una vez; lo que no, uno por uno.
//   - Recién al confirmar se descuenta del Kardex de INVESTOCK, SOLO lo que
//     salió (nunca más de lo pedido), registrado como un Egreso normal
//     (DESPACHO o GARANTIA) para que historial y reportes lo vean igual.
//   - Cuando todo el corte está confirmado se cierra, y lo que faltó le
//     llega a Yair, a Bryan Ríos y a Jariel en un solo aviso.

type Result = { ok: true } | { ok: false; error: string };

const BACKFILL_NO_SCAN = "Este es un manifiesto atrasado: esa mercadería ya salió. No se escanea — Daniel lo confirma de una vez.";

const LOT_URL = "/area/workspace?tab=egresos&otab=solicitud";

export async function recordPick(params: { lotId: string; catalogItemId: string; quantity: number; userId: string | null; onlyAssigned?: boolean }): Promise<Result> {
  const lot = await getCompiledLot(params.lotId);
  if (!lot) return { ok: false, error: "No encontrado." };
  if (lot.status !== "SENT") return { ok: false, error: lot.status === "DRAFT" ? "Este corte todavía no se envía." : "Este corte ya se cerró." };
  if (lot.backfill) return { ok: false, error: BACKFILL_NO_SCAN };
  const line = lot.picking.find((p) => p.catalogItemId === params.catalogItemId);
  if (!line) return { ok: false, error: "Este producto no está en el manifiesto de este corte." };
  if (line.confirmedAt) return { ok: false, error: "Daniel ya confirmó este producto — ya no se puede cambiar." };
  if (params.onlyAssigned && lot.blocks.find((b) => b.carrier === line.block)?.assigneeId !== params.userId) {
    return { ok: false, error: `Este producto es del bloque ${carrierLabel(line.block)}, que Daniel no te asignó — no lo registres.` };
  }
  if (!Number.isInteger(params.quantity) || params.quantity < 0) return { ok: false, error: "Cantidad inválida." };

  await prisma.fulfillmentLotPick.upsert({
    where: { lotId_catalogItemId: { lotId: params.lotId, catalogItemId: params.catalogItemId } },
    create: { lotId: params.lotId, catalogItemId: params.catalogItemId, pickedQty: params.quantity, pickedById: params.userId },
    update: { pickedQty: params.quantity, pickedById: params.userId, pickedAt: new Date() },
  });

  // Pedido del usuario 2026-10-01: los cortes se contaban pero nadie los
  // confirmaba, y el stock de INVESTOCK nunca bajaba. Cuando este registro
  // completa el conteo del corte, se le avisa a Daniel — la confirmación
  // sigue siendo solo suya.
  const completesLot = line.picked === null && lot.picking.every((p) => p.catalogItemId === line.catalogItemId || p.picked !== null || !!p.confirmedAt);
  if (completesLot) {
    const danielId = await getInventoryLeadId();
    if (danielId) {
      const label = `${lot.manifestNumber ? `${manifestCode(lot.manifestNumber)} · ` : ""}Corte ${lot.corte} del ${lot.day.split("-").reverse().join("/")}`;
      await notifyOwner(danielId, {
        title: "Corte listo para confirmar",
        body: `${label}: tu equipo ya contó todo. Confírmalo para que se descuente del stock de INVESTOCK.`,
        url: LOT_URL,
      }).catch(() => null);
    }
  }
  return { ok: true };
}

// Pedido del usuario 2026-10-01: cuánto despacho ya contado sigue sin
// confirmar por Daniel (y por eso todavía no baja del stock). Lo usan
// Inicio y Stock Actual.
export async function getUnconfirmedDispatchSummary(): Promise<{ lots: number; units: number; since: string | null }> {
  const lots = await prisma.fulfillmentLot.findMany({ where: { status: "SENT" }, select: { id: true, day: true }, orderBy: { day: "asc" } });
  if (lots.length === 0) return { lots: 0, units: 0, since: null };
  const picks = await prisma.fulfillmentLotPick.findMany({
    where: { lotId: { in: lots.map((l) => l.id) }, confirmedAt: null, pickedQty: { gt: 0 } },
    select: { pickedQty: true },
  });
  return { lots: lots.length, units: picks.reduce((s, p) => s + (p.pickedQty ?? 0), 0), since: lots[0].day };
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
  if (lot.backfill) return { ok: false, error: BACKFILL_NO_SCAN };

  let confirmed = 0;
  const confirmedNow: string[] = [];
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
      if (line.picked === null) {
        confirmed++;
        confirmedNow.push(id);
      }
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
    confirmedNow.push(id);
  }

  await notifyGuideHolds(params.lotId, confirmedNow).catch((e) => console.error("[fulfillment holds]", e));
  await maybeCloseLot(params.lotId);
  return { ok: true, confirmed };
}

// Manifiesto atrasado (pedido del usuario 2026-09-29): la mercadería ya
// salió hace días, así que Daniel confirma todo de una vez — cada producto
// como "salió todo lo pedido", sin escanear. Se descuenta del Kardex igual
// que un corte normal (Egreso de DESPACHO / GARANTIA), con la fecha de hoy
// (el Kardex va en orden y meter una salida en el pasado descuadraría los
// saldos que vinieron después). Los productos con conteo físico posterior
// al manifiesto se confirman sin descontar (ver countedAfter). No se manda
// ningún aviso de faltantes ni de guías a retener: ya se despachó.
export async function confirmBackfillLot(params: { lotId: string; userId: string | null }): Promise<Result & { discounted?: number; skipped?: number }> {
  const lot = await getCompiledLot(params.lotId);
  if (!lot) return { ok: false, error: "No encontrado." };
  if (!lot.backfill) return { ok: false, error: "Este corte no es un manifiesto atrasado." };
  if (lot.status !== "SENT") return { ok: false, error: "Este corte ya se cerró." };

  const counted = new Set(lot.countedAfter.map((c) => c.catalogItemId));
  let discounted = 0;
  let skipped = 0;
  for (const line of lot.picking) {
    if (line.confirmedAt) continue;
    await prisma.fulfillmentLotPick.upsert({
      where: { lotId_catalogItemId: { lotId: params.lotId, catalogItemId: line.catalogItemId } },
      create: { lotId: params.lotId, catalogItemId: line.catalogItemId, pickedQty: line.needed, pickedById: params.userId },
      update: {},
    });
    const claimed = await prisma.fulfillmentLotPick.updateMany({
      where: { lotId: params.lotId, catalogItemId: line.catalogItemId, confirmedAt: null },
      data: { pickedQty: line.needed, confirmedQty: line.needed, confirmedAt: new Date(), confirmedById: params.userId },
    });
    if (claimed.count === 0) continue;
    if (counted.has(line.catalogItemId)) {
      skipped++;
      continue;
    }
    try {
      await discount({ lotId: params.lotId, reason: "DESPACHO", catalogItemId: line.catalogItemId, name: line.name, quantity: line.normalNeeded, userId: params.userId });
    } catch (e) {
      console.error("[fulfillment backfill] No se pudo descontar del Kardex:", e);
      await prisma.fulfillmentLotPick.updateMany({ where: { lotId: params.lotId, catalogItemId: line.catalogItemId }, data: { confirmedQty: null, confirmedAt: null, confirmedById: null } });
      return { ok: false, error: `No se pudo descontar "${line.name}" del Kardex — vuelve a intentarlo (lo ya descontado no se repite).` };
    }
    try {
      await discount({ lotId: params.lotId, reason: "GARANTIA", catalogItemId: line.catalogItemId, name: line.name, quantity: line.warrantyNeeded, userId: params.userId });
    } catch (e) {
      console.error("[fulfillment backfill] No se pudo descontar la garantía del Kardex:", e);
      return { ok: false, error: `"${line.name}": se descontó el despacho pero no la parte de garantía (${line.warrantyNeeded}). Avísale al administrador.` };
    }
    discounted++;
  }

  // Garantías de solo una pieza: salen de repuestos, igual que en un corte normal.
  for (const w of lot.warranty) {
    if (w.mode !== "PIECE" || w.pieceConfirmedAt) continue;
    const claimed = await prisma.fulfillmentRequestItem.updateMany({ where: { id: w.itemId, pieceConfirmedAt: null }, data: { pieceConfirmedAt: new Date(), pieceConfirmedById: params.userId } });
    if (claimed.count === 0) continue;
    const batchId = await outflowBatchFor(params.lotId, "GARANTIA", params.userId);
    await prisma.merchandiseOutflowItem.create({
      data: { batchId, catalogItemId: null, declaredName: `Pieza "${w.piece}" de ${w.name} (guía ${w.guide})`, quantity: w.quantity },
    });
  }

  await prisma.fulfillmentLot.updateMany({ where: { id: params.lotId, status: "SENT" }, data: { status: "CLOSED", closedAt: new Date() } });
  await recomputeAutoFillRate(lot.day).catch((e) => console.error("[fill rate auto]", e));
  return { ok: true, discounted, skipped };
}

// Garantía de solo una pieza: sale del stock de repuestos (confirmado por
// el usuario) — queda registrada en el Egreso de GARANTIA sin producto
// vinculado, así nunca descuenta el Kardex del producto.
export async function confirmWarrantyPiece(params: { lotId: string; itemId: string; userId: string | null }): Promise<Result> {
  const item = await prisma.fulfillmentRequestItem.findUnique({
    where: { id: params.itemId },
    select: { quantity: true, warrantyMode: true, warrantyPiece: true, warrantyGuide: true, pieceConfirmedAt: true, catalogItem: { select: { name: true } }, batch: { select: { lotId: true, lot: { select: { status: true, day: true, createdAt: true } } } } },
  });
  if (!item || item.batch.lotId !== params.lotId || item.warrantyMode !== "PIECE") return { ok: false, error: "No encontrado." };
  if (item.batch.lot?.status !== "SENT") return { ok: false, error: "Este corte no está abierto para confirmar." };
  if (item.batch.lot && isBackfillLot(item.batch.lot)) return { ok: false, error: BACKFILL_NO_SCAN };
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

// Pedido de Daniel 2026-09-26: en cuanto Daniel confirma que de un producto
// salió menos de lo pedido, el equipo sabe qué guías retener (ver
// fulfillmentHolds.ts). Va a todo INVESTOCK activo (desde 2026-10-01, antes
// Fulfillment): son quienes empacan y entregan las guías a la
// transportadora. Sin montos.
async function notifyGuideHolds(lotId: string, catalogItemIds: string[]) {
  if (catalogItemIds.length === 0) return;
  const lot = await getCompiledLot(lotId);
  if (!lot) return;
  const holds = computeGuideHolds(lot).filter((h) => h.final && catalogItemIds.includes(h.catalogItemId));
  if (holds.length === 0) return;
  const label = `${lot.manifestNumber ? `${manifestCode(lot.manifestNumber)} · ` : ""}Corte ${lot.corte} del ${lot.day.split("-").reverse().join("/")}`;
  const list = holds.map((h) => `${h.justCode ? `${h.justCode} ` : ""}${h.name}: faltan ${h.missing} → retén ${holdSummary(h, carrierLabel)}`).join(". ");
  const team = await prisma.user.findMany({
    where: { isActive: true, OR: [{ department: { code: "INV" } }, { isLeader: true, leadsDept: { code: "INV" } }] },
    select: { id: true },
  });
  for (const u of team) {
    await notifyOwner(u.id, { title: "Guías a retener (falta stock)", body: `${label}: ${list}.`, url: LOT_URL }).catch(() => null);
  }
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

  // Bryan Ríos y Jariel (quien hace las compras) — pedido de Daniel
  // 2026-09-26. Misma lista que el aviso de "Stock insuficiente". Antes
  // también iba al líder de Fulfillment; desde 2026-10-01 ese rol es del
  // propio Líder de Inventarios, que es quien cierra el corte.
  const recipients = new Set<string>();
  for (const id of await purchaseDeciderIds()) recipients.add(id);
  for (const id of recipients) {
    await notifyOwner(id, { title: "Faltaron productos en el despacho", body, url: LOT_URL });
  }
}

// ---- Bloques asignados (pedido de Daniel 2026-09-26) ----------------------

// Quién se puede asignar: el equipo de INVESTOCK activo (Daniel incluido;
// desde 2026-10-01 incluye a la ex gente de Fulfillment). Por departamento,
// no por nombre, para que alguien nuevo aparezca solo — mismo criterio que
// fulfillmentPickScope.
export async function listInventoryTeam(): Promise<{ id: string; name: string }[]> {
  return prisma.user.findMany({
    where: {
      isActive: true,
      OR: [{ department: { code: "INV" } }, { isLeader: true, leadsDept: { code: "INV" } }],
    },
    select: { id: true, name: true },
    orderBy: { name: "asc" },
  });
}

// Daniel asigna (o quita, con assigneeId null) un bloque del corte. A quien
// le toca le llega un aviso con cuántos productos y unidades son.
export async function assignBlock(params: { lotId: string; carrier: string; assigneeId: string | null; userId: string | null }): Promise<Result> {
  const lot = await getCompiledLot(params.lotId);
  if (!lot) return { ok: false, error: "No encontrado." };
  if (lot.status !== "SENT") return { ok: false, error: lot.status === "DRAFT" ? "Este corte todavía no se envía." : "Este corte ya se cerró." };
  if (lot.backfill) return { ok: false, error: BACKFILL_NO_SCAN };
  if (!lot.blocks.some((b) => b.carrier === params.carrier)) return { ok: false, error: "Ese bloque no está en este corte." };

  if (!params.assigneeId) {
    await prisma.fulfillmentLotBlock.deleteMany({ where: { lotId: params.lotId, carrier: params.carrier } });
    return { ok: true };
  }
  const team = await listInventoryTeam();
  if (!team.some((t) => t.id === params.assigneeId)) return { ok: false, error: "Esa persona no puede sacar mercadería de un corte." };

  const prev = lot.blocks.find((b) => b.carrier === params.carrier)?.assigneeId;
  await prisma.fulfillmentLotBlock.upsert({
    where: { lotId_carrier: { lotId: params.lotId, carrier: params.carrier } },
    create: { lotId: params.lotId, carrier: params.carrier, assigneeId: params.assigneeId, assignedById: params.userId },
    update: { assigneeId: params.assigneeId, assignedById: params.userId, assignedAt: new Date() },
  });
  if (prev !== params.assigneeId && params.assigneeId !== params.userId) {
    const items = lot.picking.filter((p) => p.block === params.carrier);
    const units = items.reduce((s, p) => s + p.needed, 0);
    await notifyOwner(params.assigneeId, {
      title: "Te asignaron un bloque del corte",
      body: `${lot.manifestNumber ? manifestCode(lot.manifestNumber) : `Corte ${lot.corte}`} · bloque ${carrierLabel(params.carrier)}: ${items.length} productos, ${units} unidades. Sácalos y regístralos escaneando la percha.`,
      url: LOT_URL,
    }).catch(() => null);
  }
  return { ok: true };
}
