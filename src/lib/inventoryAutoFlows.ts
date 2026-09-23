import { prisma } from "@/lib/prisma";
import { recordKardexEntry } from "@/lib/stockKardex";
import { maybeMarkBatchClosed, notifyFinanceLeadWeeklyBatchReady } from "@/lib/merchandiseReentry";

// Confirmado 2026-09-23, pedido explícito del usuario: "de ahora en adelante
// ya solo trabajaremos con INVESTOCK" + "todo debe quedar automatizado, el
// factor humano solo cuando sea realmente necesario". Antes había tres
// botones de "¿ya lo pasaste a Just?" que además eran el ÚNICO momento en
// que la mercadería volvía a sumar en INVESTOCK — si nadie los tocaba, el
// stock quedaba corto para siempre. Ahora esa entrada ocurre sola en cuanto
// el último paso humano real (revisar/aprobar/cargar productos) se completa.
// Cada función es idempotente: "reclama" la fila con un update condicionado
// (campo todavía en null) antes de escribir el Kardex, así dos llamadas en
// paralelo (la ruta que completa el paso + el barrido del cron) nunca suman
// dos veces. Los campos *ById quedan en null = lo hizo el sistema.

// Reingreso de mercadería (devoluciones): la parte buena de cada producto
// entra a INVESTOCK apenas Daniel termina de aprobar el lote — ya no espera
// a que Nairoby la "suba a Just" ni al último día laboral de la semana.
export async function autoRestockApprovedReentryItems(batchId?: string): Promise<number> {
  const items = await prisma.merchandiseReentryItem.findMany({
    where: { goodQty: { gt: 0 }, justUploadedAt: null, batch: { danielApprovedAt: { not: null }, ...(batchId ? { id: batchId } : {}) } },
    select: { id: true, batchId: true, catalogItemId: true, goodQty: true },
    orderBy: { createdAt: "asc" },
  });
  let restocked = 0;
  const touchedBatches = new Set<string>();
  for (const item of items) {
    const claimed = await prisma.merchandiseReentryItem.updateMany({
      where: { id: item.id, justUploadedAt: null },
      data: { justUploadedAt: new Date(), justUploadedById: null },
    });
    if (claimed.count === 0) continue;
    touchedBatches.add(item.batchId);
    // Ítems sin catalogItemId (declarados solo por nombre) no tienen a qué
    // producto sumarle — igual quedan cerrados para no trabar el lote.
    if (!item.catalogItemId) continue;
    await recordKardexEntry({
      catalogItemId: item.catalogItemId,
      type: "IN",
      quantity: item.goodQty,
      unitCost: null,
      occurredAt: new Date(),
    })
      .then(() => { restocked++; })
      .catch((err) => console.error("[autoRestockApprovedReentryItems] No se pudo registrar la entrada de Kardex:", err));
  }
  for (const id of touchedBatches) await maybeMarkBatchClosed(id);
  return restocked;
}

// Guías canceladas: vuelven a INVESTOCK solas en cuanto están los tres
// pasos (Bryan gestionó con la transportadora + Yair confirmó que la sacó de
// Fulfillment + productos cargados), sin importar cuál terminó último.
export async function autoReingresoReadyCancelledGuides(reportIds?: string[]): Promise<number> {
  const ready = await prisma.cancelledGuideReport.findMany({
    where: {
      reingresadoAt: null,
      itemsAssignedAt: { not: null },
      batchManagedAt: { not: null },
      fulfillmentRemovedAt: { not: null },
      ...(reportIds ? { id: { in: reportIds } } : {}),
    },
    select: { id: true, items: { select: { catalogItemId: true, quantity: true } } },
  });
  let done = 0;
  for (const report of ready) {
    const claimed = await prisma.cancelledGuideReport.updateMany({
      where: { id: report.id, reingresadoAt: null },
      data: { reingresadoAt: new Date(), reingresadoById: null },
    });
    if (claimed.count === 0) continue;
    done++;
    // Secuencial, no en paralelo: cada línea depende del saldo que dejó la
    // anterior del mismo producto.
    for (const item of report.items) {
      if (!item.catalogItemId) continue;
      await recordKardexEntry({
        catalogItemId: item.catalogItemId,
        type: "IN",
        quantity: item.quantity,
        unitCost: null,
        occurredAt: new Date(),
      }).catch((err) => console.error("[autoReingresoReadyCancelledGuides] No se pudo registrar la entrada de Kardex:", err));
    }
  }
  return done;
}

// Ciclo semanal de dañados de Reingreso: el corte del sábado se cierra solo
// (antes Daniel tenía que confirmar que lo dio de baja en Just). Esas
// unidades dañadas nunca sumaron en INVESTOCK (solo entra la parte buena),
// así que no hay nada que restar — solo pasa directo a la verificación
// física de Nairoby, que sí es un paso humano real.
export async function autoCloseFinishedWeeklyWriteOffBatches(): Promise<number> {
  const due = await prisma.merchandiseWeeklyWriteOffBatch.findMany({
    where: { justWrittenOffAt: null, weekEnd: { lt: new Date() } },
    select: { id: true, _count: { select: { items: true } } },
  });
  let closed = 0;
  for (const b of due) {
    const updated = await prisma.merchandiseWeeklyWriteOffBatch
      .update({ where: { id: b.id, justWrittenOffAt: null }, data: { justWrittenOffAt: new Date(), justWrittenOffById: null } })
      .catch(() => null);
    if (!updated) continue;
    closed++;
    if (b._count.items > 0) await notifyFinanceLeadWeeklyBatchReady(updated);
  }
  return closed;
}

// Reclamo posterior al cierre (daño descubierto días después de recibir):
// antes, tras aprobarlo, Daniel tenía que dar de baja las unidades en Just
// y re-escribir la cantidad para confirmarlo. Ahora, apenas lo aprueba, las
// unidades dañadas salen solas de INVESTOCK y el reclamo pasa directo a
// gestión con el proveedor. Si el producto ya se había vendido (SOLD), esas
// unidades ya no estaban en bodega — no se resta nada, solo se libera.
export async function autoWriteOffApprovedLateClaims(reportId?: string): Promise<number> {
  const claims = await prisma.purchaseRequestUrgentReport.findMany({
    where: { isLateClaim: true, reviewedByLeadAt: { not: null }, rejectedAt: null, justConfirmedAt: null, ...(reportId ? { id: reportId } : {}) },
    select: { id: true, damagedQty: true, stockStatus: true, request: { select: { catalogItemId: true } } },
  });
  let done = 0;
  for (const c of claims) {
    const claimed = await prisma.purchaseRequestUrgentReport.updateMany({
      where: { id: c.id, justConfirmedAt: null },
      data: { justConfirmedAt: new Date(), justConfirmedById: null },
    });
    if (claimed.count === 0) continue;
    done++;
    if (c.stockStatus === "SOLD" || c.damagedQty <= 0) continue;
    await recordKardexEntry({
      catalogItemId: c.request.catalogItemId,
      type: "OUT",
      quantity: c.damagedQty,
      unitCost: null,
      occurredAt: new Date(),
    }).catch((err) => console.error("[autoWriteOffApprovedLateClaims] No se pudo registrar la salida de Kardex:", err));
  }
  return done;
}

// Barrido completo — lo corre el cron diario y las pantallas que muestran
// estas colas, para que nada quede pegado aunque el paso que lo completó no
// haya disparado la entrada (ej. filas que ya estaban esperando antes de
// este cambio).
export async function runInventoryAutoFlows(): Promise<void> {
  await autoRestockApprovedReentryItems().catch((err) => console.error("[runInventoryAutoFlows] reingreso:", err));
  await autoReingresoReadyCancelledGuides().catch((err) => console.error("[runInventoryAutoFlows] guías canceladas:", err));
  await autoCloseFinishedWeeklyWriteOffBatches().catch((err) => console.error("[runInventoryAutoFlows] dañados semanales:", err));
  await autoWriteOffApprovedLateClaims().catch((err) => console.error("[runInventoryAutoFlows] reclamos posteriores:", err));
}
