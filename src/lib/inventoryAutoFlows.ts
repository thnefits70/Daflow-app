import { prisma } from "@/lib/prisma";
import { recordKardexEntry } from "@/lib/stockKardex";
import { applyReturnToVariants, detectReturnVariants } from "@/lib/variantStock";
import { cacheGuideLabelsForBatch } from "@/lib/localWarranty";
import { autoApproveReadyReentryItems, maybeMarkBatchClosed, notifyFinanceLeadWeeklyBatchReady } from "@/lib/merchandiseReentry";

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
// Cambiado 2026-10-02, pedido del usuario: cada producto entra apenas está
// aprobado (lo bueno se aprueba solo al enviar), sin esperar a que Daniel
// resuelva lo dañado del resto del lote. Entra con su costo real
// (unitCost, el de la guía) o, si se registró a mano, al costo promedio.
export async function autoRestockApprovedReentryItems(batchId?: string): Promise<number> {
  const items = await prisma.merchandiseReentryItem.findMany({
    where: { goodQty: { gt: 0 }, justUploadedAt: null, approvedAt: { not: null }, batch: { submittedAt: { not: null }, ...(batchId ? { id: batchId } : {}) } },
    select: { id: true, batchId: true, catalogItemId: true, goodQty: true, unitCost: true, variantCounts: true },
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
      unitCost: item.unitCost ?? null,
      occurredAt: new Date(),
    })
      .then(() => { restocked++; return true; })
      .catch((err) => { console.error("[autoRestockApprovedReentryItems] No se pudo registrar la entrada de Kardex:", err); return false; })
      // Stock por variante (2026-10-06): el color que eligió Joel, solo si entró al Kardex.
      .then((ok) => (ok && Array.isArray(item.variantCounts) ? applyReturnToVariants(item.id, item.catalogItemId!, item.goodQty, item.variantCounts as { name: string; qty: number }[]) : undefined))
      .catch((e) => console.error("[variant stock return]", e));
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
    select: { id: true, guideNumber: true, items: { select: { id: true, catalogItemId: true, quantity: true } } },
  });
  let done = 0;
  for (const report of ready) {
    const claimed = await prisma.cancelledGuideReport.updateMany({
      where: { id: report.id, reingresadoAt: null },
      data: { reingresadoAt: new Date(), reingresadoById: null },
    });
    if (claimed.count === 0) continue;
    done++;
    // Stock por variante (2026-10-06): el color/talla que dice la etiqueta
    // de la guía cancelada (como en las devoluciones escaneadas).
    const qtyByItem = new Map<string, number>();
    for (const i of report.items) if (i.catalogItemId) qtyByItem.set(i.catalogItemId, (qtyByItem.get(i.catalogItemId) ?? 0) + i.quantity);
    const lines = [...qtyByItem].map(([catalogItemId, quantity]) => ({ catalogItemId, quantity }));
    const colors = await cancelledGuideColors(report.guideNumber, lines).catch((e) => {
      console.error("[variant stock cancelled guide]", e);
      return new Map<string, { name: string; qty: number }[]>();
    });
    // Secuencial, no en paralelo: cada línea depende del saldo que dejó la
    // anterior del mismo producto.
    for (const item of report.items) {
      if (!item.catalogItemId) continue;
      const ok = await recordKardexEntry({
        catalogItemId: item.catalogItemId,
        type: "IN",
        quantity: item.quantity,
        unitCost: null,
        occurredAt: new Date(),
      })
        .then(() => true)
        .catch((err) => {
          console.error("[autoReingresoReadyCancelledGuides] No se pudo registrar la entrada de Kardex:", err);
          return false;
        });
      // El color se reparte entre las filas del mismo producto.
      const pool = colors.get(item.catalogItemId);
      if (ok && pool?.length) {
        const mine: { name: string; qty: number }[] = [];
        let left = item.quantity;
        for (const c of pool) {
          const take = Math.min(c.qty, left);
          if (take <= 0) continue;
          mine.push({ name: c.name, qty: take });
          c.qty -= take;
          left -= take;
        }
        await applyReturnToVariants(item.id, item.catalogItemId, item.quantity, mine).catch((e) => console.error("[variant stock cancelled guide]", e));
      }
    }
  }
  return done;
}

// Color/talla de cada producto según la etiqueta de la guía cancelada.
async function cancelledGuideColors(guideNumber: string, lines: { catalogItemId: string; quantity: number }[]): Promise<Map<string, { name: string; qty: number }[]>> {
  if (lines.length === 0) return new Map();
  let gv = await prisma.fulfillmentRequestGuide.findFirst({ where: { guideNumber: { equals: guideNumber, mode: "insensitive" } }, select: { batchId: true, guideNumber: true, labelVariants: true } });
  if (!gv) return new Map();
  if (gv.labelVariants === null) {
    await cacheGuideLabelsForBatch(gv.batchId);
    gv = await prisma.fulfillmentRequestGuide.findUnique({ where: { guideNumber: gv.guideNumber }, select: { batchId: true, guideNumber: true, labelVariants: true } });
  }
  if (!gv || !Array.isArray(gv.labelVariants)) return new Map();
  return detectReturnVariants({ fulfillmentBatchId: gv.batchId, labelVariants: gv.labelVariants as { code: string; variant: string | null; qty: number }[], lines });
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
  await autoApproveReadyReentryItems().catch((err) => console.error("[runInventoryAutoFlows] reingreso automático:", err));
  await autoRestockApprovedReentryItems().catch((err) => console.error("[runInventoryAutoFlows] reingreso:", err));
  await autoReingresoReadyCancelledGuides().catch((err) => console.error("[runInventoryAutoFlows] guías canceladas:", err));
  await autoCloseFinishedWeeklyWriteOffBatches().catch((err) => console.error("[runInventoryAutoFlows] dañados semanales:", err));
  await autoWriteOffApprovedLateClaims().catch((err) => console.error("[runInventoryAutoFlows] reclamos posteriores:", err));
}
