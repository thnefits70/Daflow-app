import { prisma } from "@/lib/prisma";
import { notifyOwner } from "@/lib/notifications";
import { getInventoryLeadId, getMarketingLeadId, getFinanceLeadId, getFulfilmentLeadId } from "@/lib/guards";
import { nextMerchandiseOutflowNumber, formatMerchandiseOutflowCode } from "@/lib/merchandiseOutflow";
import { addBusinessDays } from "@/lib/businessHours";
import {
  computeB2BPrice,
  computeB2CPriceBreakdown,
  b2cMarginPercentForQuantity,
  B2B_MARGIN_OPTIONS,
  B2B_MARGIN_DEFAULT,
  resolveCostBasisForCatalogItems,
  type B2CPriceBreakdown,
} from "@/lib/marketProduct";
import { recordKardexEntry } from "@/lib/stockKardex";

const URL_BASE = "/area/workspace?tab=ventas-externas";

// Confirmado 2026-09-18: monto que de verdad corresponde esperar en la
// cuenta de la empresa por esta venta — con recaudo, el motorizado cobra el
// total al cliente y se queda el flete él mismo (a la empresa solo le
// transfiere el resto); sin recaudo, el cliente transfiere el total
// completo directo (nadie descuenta el flete en el camino). Un solo punto
// para este cálculo — lo usan tanto la verificación con IA del comprobante
// (readExternalSalePaymentProof) como las pantallas que muestran "monto
// esperado a transferir".
export function expectedTransferAmount(sale: { totalAmount: number; isContraEntrega: boolean; freightCost: number | null }): number {
  return sale.isContraEntrega ? sale.totalAmount - (sale.freightCost ?? 0) : sale.totalAmount;
}

// Confirmado 2026-09-18, pedido explícito del usuario: los precios B2C
// siempre terminan en .99 (roundUpToNinetyNineCents en marketProduct.ts) —
// es normal y esperable que el cliente redondee al dólar completo al
// transferir (ej. $39.99 → $40.00, una diferencia de un centavo). Esta
// tolerancia cubre ese redondeo típico sin dejar pasar un monto de verdad
// distinto.
export const PAYMENT_PROOF_AMOUNT_TOLERANCE = 0.05;

// Confirmado 2026-09-14: reemplaza el "Precio unitario" que antes escribía
// el asesor a mano — el precio siempre se calcula acá, server-side, a partir
// del costo real del producto (nunca se confía en un precio que mande el
// navegador, mismo principio que market-products/route.ts). La usan tanto
// la vista previa en vivo del formulario como la creación/edición real de
// la venta.
export type PriceExternalSaleItemInput = { catalogItemId: string; quantity: number; marginPercent?: number };
// b2cBreakdown solo viene en ventas contra entrega — pedido explícito de
// Marcos 2026-09-16 para ver cómo se calculó el precio, no solo el
// resultado (ver B2CPriceBreakdownNote en ExternalSaleDeclareForm.tsx).
// costSource "just" (temporal, pedido explícito del usuario 2026-09-17):
// el producto todavía no tiene ni propuesta de Jariel ni costo real de
// Kardex (INVESTOCK), así que el precio se calculó con el costo promedio
// del último archivo de Just como respaldo — ExternalSaleDeclareForm lo
// marca para que no se confunda con un costo real.
export type PricedExternalSaleItem = { catalogItemId: string; unitPrice: number; marginPercentUsed: number; b2cBreakdown?: B2CPriceBreakdown; costSource: "proposal" | "kardex" | "just" };
export type PriceExternalSaleItemsResult = { ok: true; items: PricedExternalSaleItem[] } | { ok: false; error: string };

// El array `items` del resultado viene SIEMPRE en el mismo orden que
// `params.items` — quien lo consuma debe emparejar por posición, nunca por
// catalogItemId (un mismo producto puede repetirse en dos renglones de la
// misma venta con márgenes distintos en modo "por producto").
//
// Confirmado 2026-09-18, pedido explícito del usuario: useB2CPricing viene
// del PERFIL del asesor (User.externalSaleContraEntrega), no del switch
// "con/sin recaudo" de la venta puntual — ese switch ahora solo decide quién
// cobra y el orden del flujo (ver ExternalSale.isContraEntrega), nunca la
// fórmula de precio. Antes ambas cosas compartían el mismo booleano, así que
// Marcos (100% B2C) veía el precio cambiar de fórmula (y bajar) apenas
// marcaba "sin recaudo" para una venta ya cobrada — el precio que cotizó con
// el consultador debe quedar igual sin importar el switch.
export async function priceExternalSaleItems(params: { useB2CPricing: boolean; items: PriceExternalSaleItemInput[] }): Promise<PriceExternalSaleItemsResult> {
  if (params.items.length === 0) return { ok: false, error: "No hay productos para calcular." };

  const byCatalogItemId = await resolveCostBasisForCatalogItems(params.items.map((it) => it.catalogItemId));

  for (const it of params.items) {
    if (!byCatalogItemId.has(it.catalogItemId)) {
      return { ok: false, error: "Este producto todavía no tiene costo registrado — no se puede calcular un precio de venta." };
    }
  }

  if (params.useB2CPricing) {
    const totalQuantity = params.items.reduce((s, it) => s + it.quantity, 0);
    const marginPercent = b2cMarginPercentForQuantity(totalQuantity);
    if (marginPercent == null) {
      return { ok: false, error: "Una venta al por menor (B2C) no puede pasar de 11 unidades en total — de 12 en adelante es una venta al por mayor (B2B)." };
    }
    const items = params.items.map((it) => {
      const cost = byCatalogItemId.get(it.catalogItemId)!;
      const breakdown = computeB2CPriceBreakdown({ ...cost, totalQuantity })!;
      return { catalogItemId: it.catalogItemId, unitPrice: breakdown.finalPrice, marginPercentUsed: marginPercent, b2cBreakdown: breakdown, costSource: cost.costSource };
    });
    return { ok: true, items };
  }

  const items: PricedExternalSaleItem[] = [];
  for (const it of params.items) {
    const marginPercent = it.marginPercent ?? B2B_MARGIN_DEFAULT;
    if (!B2B_MARGIN_OPTIONS.includes(marginPercent as (typeof B2B_MARGIN_OPTIONS)[number])) {
      return { ok: false, error: `Porcentaje de ganancia inválido: ${marginPercent}%.` };
    }
    const cost = byCatalogItemId.get(it.catalogItemId)!;
    const unitPrice = computeB2BPrice({ ...cost, marginPercent });
    items.push({ catalogItemId: it.catalogItemId, unitPrice, marginPercentUsed: marginPercent, costSource: cost.costSource });
  }
  return { ok: true, items };
}

// Nombre corto para notificaciones/tarjetas que solo tienen espacio para una
// línea — el primer producto, +"N más" si hay varios (ver ExternalSaleItem).
export function saleItemsSummary(items: { declaredProductName: string; catalogItem: { name: string } | null }[]): string {
  if (items.length === 0) return "—";
  const first = items[0].catalogItem?.name ?? items[0].declaredProductName;
  return items.length === 1 ? first : `${first} +${items.length - 1} más`;
}

export async function notifyMarketingLeadNewExternalSale(code: string): Promise<void> {
  const leadId = await getMarketingLeadId();
  if (!leadId) return;
  await notifyOwner(leadId, { title: "Nueva venta externa por revisar", body: `${code} — pendiente de tu aprobación.`, url: `${URL_BASE}&etab=revision` }).catch(() => null);
}

export async function notifyAdvisorReviewResult(advisorId: string, code: string, approved: boolean, reason?: string | null): Promise<void> {
  await notifyOwner(advisorId, {
    title: approved ? "✅ Venta externa aprobada" : "❌ Venta externa rechazada",
    body: approved ? `${code} — ya puedes subir el comprobante de pago.` : `${code} — ${reason ?? "sin motivo detallado"}`,
    url: `${URL_BASE}&etab=declarar`,
  }).catch(() => null);
}

// Confirmado 2026-09-01, pedido explícito del usuario: Bryan puede rechazar
// un producto puntual (ej. precio mal) sin tumbar toda la venta — solo le
// llega el aviso al asesor dueño de la venta, sobre ese producto específico.
export async function notifyAdvisorItemRejected(advisorId: string, code: string, productName: string, reason: string): Promise<void> {
  await notifyOwner(advisorId, {
    title: "❌ Producto rechazado en venta externa",
    body: `${code} — ${productName}: ${reason}. Corrígelo o elimínalo y reenvíalo.`,
    url: `${URL_BASE}&etab=declarar`,
  }).catch(() => null);
}

export async function notifyAdminPaymentProofUploaded(code: string): Promise<void> {
  await notifyOwner("admin", { title: "💵 Comprobante de venta externa subido", body: `${code} — revisa y confirma que llegó el pago.`, url: `${URL_BASE}&etab=pagos` }).catch(() => null);
}

export async function notifyInventoryLeadExternalSaleApproved(code: string): Promise<void> {
  const leadId = await getInventoryLeadId();
  if (!leadId) return;
  await notifyOwner(leadId, { title: "📦 Venta externa lista para agrupar", body: `${code} — asigna quién la agrupa.`, url: `${URL_BASE}&etab=despacho` }).catch(() => null);
}

export async function notifyColaboradorDispatchAssigned(colaboradorId: string, code: string, productName: string): Promise<void> {
  await notifyOwner(colaboradorId, { title: "📦 Preparación asignada", body: `${code} — ${productName}. Agrupa, toma fotos y marca listo.`, url: `${URL_BASE}&etab=entregas` }).catch(() => null);
}

export async function notifyFinanceLeadExternalSalePendingInvoice(code: string): Promise<void> {
  const leadId = await getFinanceLeadId();
  if (!leadId) return;
  await notifyOwner(leadId, { title: "🧾 Venta externa lista para facturar", body: `${code} — pago confirmado, ya puedes subir la factura.`, url: `${URL_BASE}&etab=pagos` }).catch(() => null);
}

export async function notifyFulfilmentLeadExternalSalePrepReady(code: string): Promise<void> {
  const leadId = await getFulfilmentLeadId();
  if (!leadId) return;
  await notifyOwner(leadId, { title: "📦 Venta externa lista para embalar", body: `${code} — Inventario ya agrupó, asigna quién embala y entrega.`, url: `${URL_BASE}&etab=embalaje` }).catch(() => null);
}

export async function notifyColaboradorPackAssigned(colaboradorId: string, code: string, productName: string): Promise<void> {
  await notifyOwner(colaboradorId, { title: "📦 Embalaje asignado", body: `${code} — ${productName}. Embala y entrega al motorizado con foto en vivo.`, url: `${URL_BASE}&etab=entregas` }).catch(() => null);
}

// Confirmado 2026-09-23, pedido de Joel: quien agrupó se entera a quién de
// Fulfilment se le asignó embalar su venta, para que el equipo de
// Inventario sepa cómo sigue el proceso después de ellos.
export async function notifyGrouperPackAssigned(grouperId: string, code: string, productName: string, packerName: string): Promise<void> {
  await notifyOwner(grouperId, { title: "📦 Embalaje asignado", body: `${code} — ${productName}. Se le asignó a ${packerName} para embalar y entregar.`, url: `${URL_BASE}&etab=historial` }).catch(() => null);
}

export async function notifyFinanceLeadExternalSaleReadyToClose(code: string): Promise<void> {
  const leadId = await getFinanceLeadId();
  if (!leadId) return;
  await notifyOwner(leadId, { title: "Venta externa lista para cerrar", body: `${code} — pago confirmado y mercadería entregada.`, url: `${URL_BASE}&etab=cierre` }).catch(() => null);
}

type InvolvedSale = {
  advisorId: string;
  reviewedById: string | null;
  invoiceUploadedById: string | null;
  dispatchAssignedToId: string | null;
  packAssignedToId: string | null;
  deliveredById: string | null;
};

// Confirmado 2026-09-23, pedido de Joel (aprobado por el usuario): al
// colaborador de Inventario que agrupa (dispatchAssignedToId) le llegaban
// avisos que no le tocan (cerrada, devuelta, verificar entrega, falta
// comprobante). Solo debe recibir 2: "Preparación asignada" (agrupar) y a
// quién se le asignó embalar (notifyGrouperPackAssigned) — por eso queda
// fuera de los involucrados salvo que se pida explícitamente. Si esa misma
// persona tiene otro rol en la venta, sigue recibiendo por ese rol.
function involvedRecipientIds(sale: InvolvedSale, opts: { includeGrouper?: boolean } = {}): string[] {
  const grouperId = opts.includeGrouper ? sale.dispatchAssignedToId : null;
  return [...new Set([sale.advisorId, sale.reviewedById, sale.invoiceUploadedById, grouperId, sale.packAssignedToId, sale.deliveredById].filter((id): id is string => !!id))];
}

// Confirmado 2026-08-25: pedido explícito del usuario — al cerrar, TODOS los
// involucrados reciben aviso (el link los lleva a la pantalla con las fotos
// de producto/entrega, el push en sí es solo texto).
export async function notifyEveryoneExternalSaleClosed(sale: { code: string } & InvolvedSale): Promise<void> {
  await Promise.all(
    involvedRecipientIds(sale).map((id) =>
      notifyOwner(id, { title: "✅ Venta externa cerrada", body: `${sale.code} — Nairoby ya registró el pago completo.`, url: `${URL_BASE}&etab=historial` }).catch(() => null)
    )
  );
}

// Confirmado 2026-09-16, pedido explícito del usuario: reportar la
// devolución NO suma el stock todavía — son 3 pasos, cada uno con su
// propio aviso, para que el número de INVESTOCK solo suba cuando el
// producto de verdad volvió a bodega:
// 1) el asesor reporta → avisa a Inventario que debe llegar esa mercadería.
// 2) el equipo de Inventario la recibe físicamente → avisa a Daniel que
//    falta su aprobación (mismo criterio que la recepción de Compras).
// 3) Daniel aprueba con un clic → ahí SÍ se suma al Kardex, y se avisa a
//    todos los involucrados (mismo criterio que notifyEveryoneExternalSaleClosed).

export async function notifyInventoryLeadExternalSaleReturnReported(code: string, itemsSummary: string): Promise<void> {
  const leadId = await getInventoryLeadId();
  if (!leadId) return;
  await notifyOwner(leadId, {
    title: "↩️ Venta externa devuelta por el cliente",
    body: `${code} — ${itemsSummary}. Falta que tu equipo la reciba físicamente en bodega.`,
    url: `${URL_BASE}&etab=devoluciones`,
  }).catch(() => null);
}

export async function notifyInventoryLeadExternalSaleReturnReceived(code: string): Promise<void> {
  const leadId = await getInventoryLeadId();
  if (!leadId) return;
  await notifyOwner(leadId, {
    title: "Devolución recibida, falta tu aprobación",
    body: `${code} — tu equipo confirmó que llegó físicamente. Apruébala para que se sume de nuevo a INVESTOCK.`,
    url: `${URL_BASE}&etab=devoluciones`,
  }).catch(() => null);
}

export async function notifyEveryoneExternalSaleReturnConfirmed(sale: { code: string; paymentConfirmedAt: Date | null } & InvolvedSale): Promise<void> {
  await Promise.all(
    involvedRecipientIds(sale).map((id) =>
      notifyOwner(id, {
        title: "↩️ Venta externa devuelta",
        body: `${sale.code} — Inventario confirmó que el producto volvió a bodega. El stock ya se sumó a INVESTOCK.`,
        url: `${URL_BASE}&etab=historial`,
      }).catch(() => null)
    )
  );
  if (sale.paymentConfirmedAt) {
    const financeLeadId = await getFinanceLeadId();
    if (financeLeadId) {
      await notifyOwner(financeLeadId, {
        title: "💵 Venta externa devuelta con pago ya confirmado",
        body: `${sale.code} — revisa si hay que devolver el dinero al cliente.`,
        url: `${URL_BASE}&etab=historial`,
      }).catch(() => null);
    }
  }
}

// Confirmado 2026-09-17, pedido explícito del usuario: el asesor también
// puede cancelar su venta ya aprobada mientras el stock no haya salido
// todavía de bodega (deliveredAt vacío — ver DELETE en
// api/external-sales/[id]/route.ts, que ya bloquea si outflowBatchId
// existe). A diferencia de cancelar en PENDING (nadie más se enteró todavía),
// acá Inventario/Fulfilment puede estar en medio de agruparla o embalarla —
// se les avisa para que dejen de prepararla. Quien agrupa solo recibe este
// aviso si todavía no terminó de agrupar (prepReadyAt vacío) — ahí sí le
// toca detenerse; después ya no es trabajo suyo.
export async function notifyEveryoneExternalSaleCancelled(sale: { code: string; prepReadyAt: Date | null } & InvolvedSale): Promise<void> {
  await Promise.all(
    involvedRecipientIds(sale, { includeGrouper: !sale.prepReadyAt }).map((id) =>
      notifyOwner(id, { title: "🚫 Venta externa cancelada", body: `${sale.code} — el asesor la canceló, el cliente no la quiso. Detén cualquier preparación en curso.`, url: `${URL_BASE}&etab=historial` }).catch(() => null)
    )
  );
}

export type ExternalSaleTimingPush = { ownerId: string; title: string; body: string; url: string };

// Alertas de tiempo (Parte 3) — confirmado 2026-09-01. A diferencia del
// resto de "stale pushes" de este cron, cada una se manda UNA sola vez
// (marca *AlertSentAt) porque no hay ninguna acción dentro de Daflow que
// las "resuelva" — son un aviso para verificar algo por fuera del sistema.
//
// 1) 3 días hábiles desde que el equipo de Yair entregó al motorizado, sin
//    haberse cerrado la venta todavía.
export async function getDeliveryOverduePushes(): Promise<ExternalSaleTimingPush[]> {
  const candidates = await prisma.externalSale.findMany({
    where: { deliveredAt: { not: null }, nairobyClosedAt: null, returnedAt: null, deletedAt: null, deliveryOverdueAlertSentAt: null },
    select: {
      id: true,
      code: true,
      deliveredAt: true,
      items: { select: { declaredProductName: true, catalogItem: { select: { name: true } } } },
      advisorId: true,
      reviewedById: true,
      invoiceUploadedById: true,
      dispatchAssignedToId: true,
      packAssignedToId: true,
      deliveredById: true,
    },
  });

  const now = new Date();
  const due = candidates.filter((s) => addBusinessDays(s.deliveredAt!, 3) <= now);
  if (due.length === 0) return [];

  await prisma.externalSale.updateMany({ where: { id: { in: due.map((s) => s.id) } }, data: { deliveryOverdueAlertSentAt: now } });

  const pushes: ExternalSaleTimingPush[] = [];
  for (const s of due) {
    const name = saleItemsSummary(s.items);
    for (const ownerId of involvedRecipientIds(s)) {
      pushes.push({
        ownerId,
        title: "⏰ Venta externa — verificar entrega",
        body: `${s.code} — ${name}. Ya pasaron 3 días hábiles desde que se entregó al motorizado, confirma que de verdad llegó al cliente.`,
        url: `${URL_BASE}&etab=historial`,
      });
    }
  }
  return pushes;
}

// 2) Solo contra entrega (Marcos): 48 horas desde la entrega sin subir el
//    comprobante de pago — mercadería entregada que corre riesgo de
//    quedarse sin cobrar.
export async function getContraEntregaPaymentOverduePushes(): Promise<ExternalSaleTimingPush[]> {
  const cutoff = new Date(Date.now() - 48 * 60 * 60 * 1000);
  const due = await prisma.externalSale.findMany({
    where: {
      isContraEntrega: true,
      deliveredAt: { not: null, lte: cutoff },
      paymentProofUrl: null,
      deletedAt: null,
      contraEntregaPaymentAlertSentAt: null,
    },
    select: {
      id: true,
      code: true,
      items: { select: { declaredProductName: true, catalogItem: { select: { name: true } } } },
      advisorId: true,
      reviewedById: true,
      invoiceUploadedById: true,
      dispatchAssignedToId: true,
      packAssignedToId: true,
      deliveredById: true,
    },
  });
  if (due.length === 0) return [];

  await prisma.externalSale.updateMany({ where: { id: { in: due.map((s) => s.id) } }, data: { contraEntregaPaymentAlertSentAt: new Date() } });

  const pushes: ExternalSaleTimingPush[] = [];
  for (const s of due) {
    const name = saleItemsSummary(s.items);
    for (const ownerId of involvedRecipientIds(s)) {
      pushes.push({
        ownerId,
        title: "⏰ Venta contra entrega — falta el comprobante",
        body: `${s.code} — ${name}. Ya pasaron 48 horas desde la entrega y todavía no se sube el comprobante de pago.`,
        url: `${URL_BASE}&etab=declarar`,
      });
    }
  }
  return pushes;
}

// Se crea apenas el colaborador confirma la entrega física — recién ahí el
// stock sale de verdad, sin importar si el pago ya se confirmó o no. Un
// renglón de egreso por cada producto de la venta (ver ExternalSaleItem).
// Confirmado 2026-09-16, pedido explícito del usuario: Just ya no se usa
// para llevar el control del inventario — todo ingreso/egreso de
// mercadería queda conectado únicamente al Kardex propio (INVESTOCK), así
// que acá mismo, en el momento en que se confirma la entrega, se resta del
// Kardex igual que hace el envío manual de un lote de Egresos normal.
export async function createOutflowForExternalSale(sale: { id: string; items: { catalogItemId: string | null; declaredProductName: string; quantity: number }[] }): Promise<string> {
  const batchNumber = await nextMerchandiseOutflowNumber();
  const batch = await prisma.merchandiseOutflowBatch.create({
    data: {
      code: formatMerchandiseOutflowCode(batchNumber),
      batchNumber,
      reason: "VENTA_EXTERNA",
      submittedAt: new Date(),
      items: { create: sale.items.map((it) => ({ catalogItemId: it.catalogItemId, declaredName: it.declaredProductName, quantity: it.quantity })) },
    },
    include: { items: { select: { id: true, catalogItemId: true, quantity: true } } },
  });
  await prisma.externalSale.update({ where: { id: sale.id }, data: { outflowBatchId: batch.id } });

  for (const item of batch.items) {
    if (!item.catalogItemId) continue;
    await recordKardexEntry({
      catalogItemId: item.catalogItemId,
      type: "OUT",
      quantity: item.quantity,
      unitCost: null,
      occurredAt: new Date(),
      merchandiseOutflowItemId: item.id,
    }).catch((err) => console.error("[external-sales] No se pudo registrar la salida de Kardex:", err));
  }

  return batch.id;
}

// Confirmado 2026-09-22, pedido de Marcos (aprobado por el usuario): en una
// venta SIN recaudo con flete, apenas el asesor confirma que el cliente
// recibió el pedido (y el pago del cliente ya está confirmado), se avisa a
// quienes pueden pagar el flete desde Caja Chica — Nairoby (Principal) y
// quien tenga la Secundaria (Jariel). Paga el primero que lo vea; la lista
// de Caja Chica deja de mostrarlo apenas uno lo paga (freightPaidAt).
export async function notifyPettyCashFreightPayable(sale: { code: string; pickupPersonName: string; freightCost: number }): Promise<void> {
  const financeLeadId = await getFinanceLeadId();
  const secundaria = await prisma.user.findMany({ where: { canManagePettyCashSecundaria: true, isActive: true }, select: { id: true } });
  const recipients: { id: string; box: "principal" | "secundaria" }[] = [];
  if (financeLeadId) recipients.push({ id: financeLeadId, box: "principal" });
  for (const u of secundaria) if (!recipients.some((r) => r.id === u.id)) recipients.push({ id: u.id, box: "secundaria" });
  await Promise.all(
    recipients.map((r) =>
      notifyOwner(r.id, {
        title: "🛵 Flete por pagar al motorizado",
        body: `${sale.code} — ${sale.pickupPersonName} — $${sale.freightCost.toFixed(2)}. El cliente ya recibió el pedido, págalo desde Caja Chica.`,
        url: `/area/workspace?tab=cajachica&box=${r.box}`,
      }).catch(() => null)
    )
  );
}

// Solo aplica si la venta de verdad tiene un flete pendiente de pagar aparte
// (sin recaudo, flete > 0, pago y recepción confirmados, todavía sin pagar).
export function isFreightPayable(sale: { isContraEntrega: boolean; freightCost: number | null; paymentConfirmedAt: Date | null; clientReceivedAt: Date | null; freightPaidAt: Date | null; deletedAt: Date | null }): boolean {
  return !sale.deletedAt && !sale.isContraEntrega && (sale.freightCost ?? 0) > 0 && !!sale.paymentConfirmedAt && !!sale.clientReceivedAt && !sale.freightPaidAt;
}
