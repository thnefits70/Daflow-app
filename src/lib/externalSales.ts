import { prisma } from "@/lib/prisma";
import { notifyOwner } from "@/lib/notifications";
import { getInventoryLeadId, getMarketingLeadId, getFinanceLeadId, getFulfilmentLeadId } from "@/lib/guards";
import { nextMerchandiseOutflowNumber, formatMerchandiseOutflowCode } from "@/lib/merchandiseOutflow";
import { addBusinessDays } from "@/lib/businessHours";
import { pickPrimarySupplierPrice, computeB2BPrice, computeB2CPriceBreakdown, b2cMarginPercentForQuantity, B2B_MARGIN_OPTIONS, B2B_MARGIN_DEFAULT, type B2CPriceBreakdown } from "@/lib/marketProduct";
import { getCurrentStockByItemIds, recordKardexEntry } from "@/lib/stockKardex";

const URL_BASE = "/area/workspace?tab=ventas-externas";

type CostBasis = { batchCost: number; batchUnits: number; freightCost: number | null; insuranceRatePercent: number };

// Confirmado 2026-09-14: costo base de un producto para calcular B2B/B2C —
// en orden de prioridad: (1) si pasó por la calculadora de Jariel en
// Análisis de Mercado (MarketProductProposal), se usan sus datos exactos;
// (2) si no, pero ya tiene costo promedio real de Kardex (INVESTOCK,
// getCurrentStockByItemIds) mayor a 0, ese costo promedio SE USA DIRECTO
// como "precio puesto en bodega" — ya es el costo real de tenerlo en
// bodega, no hace falta separar proveedor+flete (se logra pasando
// batchUnits:1, freightCost:null, así bodegaUnitCost da exactamente el
// avgCost). Seguro 6% por defecto, igual que usa MarketProductProposal.
// (3) si no tiene ninguno de los dos, el producto no se puede vender.
async function resolveCostBasis(catalogItemIds: string[]): Promise<Map<string, CostBasis>> {
  const ids = [...new Set(catalogItemIds)];
  const proposals = await prisma.marketProductProposal.findMany({
    where: { catalogItemId: { in: ids } },
    include: { supplierPrices: true },
  });
  const byCatalogItemId = new Map<string, CostBasis>();
  const proposalCatalogItemIds = new Set<string>();
  for (const p of proposals) {
    if (!p.catalogItemId) continue;
    const supplier = pickPrimarySupplierPrice(p.supplierPrices);
    if (!supplier) continue;
    proposalCatalogItemIds.add(p.catalogItemId);
    byCatalogItemId.set(p.catalogItemId, {
      batchCost: supplier.batchCost,
      batchUnits: supplier.batchUnits,
      freightCost: supplier.freightCost,
      insuranceRatePercent: p.insuranceRatePercent,
    });
  }

  const missingIds = ids.filter((id) => !proposalCatalogItemIds.has(id));
  if (missingIds.length > 0) {
    const stock = await getCurrentStockByItemIds(missingIds);
    for (const id of missingIds) {
      const avgCost = stock.get(id)?.avgCost ?? 0;
      if (avgCost > 0) byCatalogItemId.set(id, { batchCost: avgCost, batchUnits: 1, freightCost: null, insuranceRatePercent: 6 });
    }
  }

  return byCatalogItemId;
}

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
export type PricedExternalSaleItem = { catalogItemId: string; unitPrice: number; marginPercentUsed: number; b2cBreakdown?: B2CPriceBreakdown };
export type PriceExternalSaleItemsResult = { ok: true; items: PricedExternalSaleItem[] } | { ok: false; error: string };

// El array `items` del resultado viene SIEMPRE en el mismo orden que
// `params.items` — quien lo consuma debe emparejar por posición, nunca por
// catalogItemId (un mismo producto puede repetirse en dos renglones de la
// misma venta con márgenes distintos en modo "por producto").
export async function priceExternalSaleItems(params: { isContraEntrega: boolean; items: PriceExternalSaleItemInput[] }): Promise<PriceExternalSaleItemsResult> {
  if (params.items.length === 0) return { ok: false, error: "No hay productos para calcular." };

  const byCatalogItemId = await resolveCostBasis(params.items.map((it) => it.catalogItemId));

  for (const it of params.items) {
    if (!byCatalogItemId.has(it.catalogItemId)) {
      return { ok: false, error: "Este producto todavía no tiene costo registrado — no se puede calcular un precio de venta." };
    }
  }

  if (params.isContraEntrega) {
    const totalQuantity = params.items.reduce((s, it) => s + it.quantity, 0);
    const marginPercent = b2cMarginPercentForQuantity(totalQuantity);
    if (marginPercent == null) {
      return { ok: false, error: "Una venta al por menor (B2C) no puede pasar de 11 unidades en total — de 12 en adelante es una venta al por mayor (B2B)." };
    }
    const items = params.items.map((it) => {
      const cost = byCatalogItemId.get(it.catalogItemId)!;
      const breakdown = computeB2CPriceBreakdown({ ...cost, totalQuantity })!;
      return { catalogItemId: it.catalogItemId, unitPrice: breakdown.finalPrice, marginPercentUsed: marginPercent, b2cBreakdown: breakdown };
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
    items.push({ catalogItemId: it.catalogItemId, unitPrice, marginPercentUsed: marginPercent });
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

// Confirmado 2026-08-29: en pago anticipado, Daniel recién se entera cuando
// Nairoby ya facturó; en contra entrega se le avisa apenas Bryan aprueba
// (ver notifyInventoryLeadExternalSaleApproved arriba, llamada distinta
// según isContraEntrega).
export async function notifyFinanceLeadExternalSalePendingInvoice(code: string): Promise<void> {
  const leadId = await getFinanceLeadId();
  if (!leadId) return;
  await notifyOwner(leadId, { title: "🧾 Venta externa lista para facturar", body: `${code} — pago confirmado, ya puedes subir la factura.`, url: `${URL_BASE}&etab=pagos` }).catch(() => null);
}

export async function notifyInventoryLeadExternalSaleInvoiced(code: string): Promise<void> {
  const leadId = await getInventoryLeadId();
  if (!leadId) return;
  await notifyOwner(leadId, { title: "📦 Venta externa lista para agrupar", body: `${code} — Nairoby ya facturó, asigna quién la agrupa.`, url: `${URL_BASE}&etab=despacho` }).catch(() => null);
}

export async function notifyFulfilmentLeadExternalSalePrepReady(code: string): Promise<void> {
  const leadId = await getFulfilmentLeadId();
  if (!leadId) return;
  await notifyOwner(leadId, { title: "📦 Venta externa lista para embalar", body: `${code} — Inventario ya agrupó, asigna quién embala y entrega.`, url: `${URL_BASE}&etab=embalaje` }).catch(() => null);
}

export async function notifyColaboradorPackAssigned(colaboradorId: string, code: string, productName: string): Promise<void> {
  await notifyOwner(colaboradorId, { title: "📦 Embalaje asignado", body: `${code} — ${productName}. Embala y entrega al motorizado con foto en vivo.`, url: `${URL_BASE}&etab=entregas` }).catch(() => null);
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

function involvedRecipientIds(sale: InvolvedSale): string[] {
  return [...new Set([sale.advisorId, sale.reviewedById, sale.invoiceUploadedById, sale.dispatchAssignedToId, sale.packAssignedToId, sale.deliveredById].filter((id): id is string => !!id))];
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

// Confirmado 2026-09-16, pedido explícito del usuario: cuando el asesor
// reporta que el cliente no recibió/devolvió el pedido, avisa a TODOS los
// involucrados (mismo criterio que notifyEveryoneExternalSaleClosed) — y
// si el pago ya estaba confirmado, además a Finanzas puntualmente, porque
// ahí sí hay que revisar devolver o no ese dinero.
export async function notifyEveryoneExternalSaleReturned(sale: { code: string; paymentConfirmedAt: Date | null } & InvolvedSale): Promise<void> {
  await Promise.all(
    involvedRecipientIds(sale).map((id) =>
      notifyOwner(id, {
        title: "↩️ Venta externa devuelta",
        body: `${sale.code} — el asesor reportó que el cliente no recibió el pedido. El stock ya volvió a INVESTOCK.`,
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
