import { prisma } from "@/lib/prisma";
import { notifyOwner } from "@/lib/notifications";
import { getInventoryLeadId, getMarketingLeadId, getFinanceLeadId } from "@/lib/guards";
import { nextMerchandiseOutflowNumber, formatMerchandiseOutflowCode } from "@/lib/merchandiseOutflow";

const URL_BASE = "/area/workspace?tab=ventas-externas";

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

export async function notifyAdminPaymentProofUploaded(code: string): Promise<void> {
  await notifyOwner("admin", { title: "💵 Comprobante de venta externa subido", body: `${code} — revisa y confirma que llegó el pago.`, url: `${URL_BASE}&etab=pagos` }).catch(() => null);
}

export async function notifyInventoryLeadExternalSaleApproved(code: string): Promise<void> {
  const leadId = await getInventoryLeadId();
  if (!leadId) return;
  await notifyOwner(leadId, { title: "📦 Venta externa lista para despachar", body: `${code} — asigna quién la despacha.`, url: `${URL_BASE}&etab=despacho` }).catch(() => null);
}

export async function notifyColaboradorDispatchAssigned(colaboradorId: string, code: string, productName: string): Promise<void> {
  await notifyOwner(colaboradorId, { title: "📦 Despacho asignado", body: `${code} — ${productName}. Entrega y sube la foto para cerrar.`, url: `${URL_BASE}&etab=entregas` }).catch(() => null);
}

export async function notifyFinanceLeadExternalSaleReadyToClose(code: string): Promise<void> {
  const leadId = await getFinanceLeadId();
  if (!leadId) return;
  await notifyOwner(leadId, { title: "Venta externa lista para cerrar", body: `${code} — pago confirmado y mercadería entregada.`, url: `${URL_BASE}&etab=cierre` }).catch(() => null);
}

// Confirmado 2026-08-25: pedido explícito del usuario — al cerrar, TODOS los
// involucrados reciben aviso (el link los lleva a la pantalla con las fotos
// de producto/entrega, el push en sí es solo texto).
export async function notifyEveryoneExternalSaleClosed(sale: {
  code: string;
  advisorId: string;
  reviewedById: string | null;
  dispatchAssignedToId: string | null;
  deliveredById: string | null;
}): Promise<void> {
  const recipients = new Set([sale.advisorId, sale.reviewedById, sale.dispatchAssignedToId, sale.deliveredById].filter((id): id is string => !!id));
  await Promise.all(
    [...recipients].map((id) =>
      notifyOwner(id, { title: "✅ Venta externa cerrada", body: `${sale.code} — Nairoby ya registró el pago completo.`, url: `${URL_BASE}&etab=historial` }).catch(() => null)
    )
  );
}

// Se crea apenas el colaborador confirma la entrega física — recién ahí el
// stock sale de verdad, sin importar si el pago ya se confirmó o no.
export async function createOutflowForExternalSale(sale: { id: string; catalogItemId: string | null; declaredProductName: string; quantity: number }): Promise<string> {
  const batchNumber = await nextMerchandiseOutflowNumber();
  const batch = await prisma.merchandiseOutflowBatch.create({
    data: {
      code: formatMerchandiseOutflowCode(batchNumber),
      batchNumber,
      reason: "VENTA_EXTERNA",
      submittedAt: new Date(),
      items: { create: [{ catalogItemId: sale.catalogItemId, declaredName: sale.declaredProductName, quantity: sale.quantity }] },
    },
  });
  await prisma.externalSale.update({ where: { id: sale.id }, data: { outflowBatchId: batch.id } });
  return batch.id;
}
