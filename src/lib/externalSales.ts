import { prisma } from "@/lib/prisma";
import { notifyOwner } from "@/lib/notifications";
import { getInventoryLeadId, getMarketingLeadId, getFinanceLeadId, getFulfilmentLeadId } from "@/lib/guards";
import { nextMerchandiseOutflowNumber, formatMerchandiseOutflowCode } from "@/lib/merchandiseOutflow";
import { addBusinessDays } from "@/lib/businessHours";

const URL_BASE = "/area/workspace?tab=ventas-externas";

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
    where: { deliveredAt: { not: null }, nairobyClosedAt: null, deletedAt: null, deliveryOverdueAlertSentAt: null },
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
  });
  await prisma.externalSale.update({ where: { id: sale.id }, data: { outflowBatchId: batch.id } });
  return batch.id;
}
