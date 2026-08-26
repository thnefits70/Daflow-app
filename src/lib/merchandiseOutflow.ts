import { prisma } from "@/lib/prisma";
import { notifyOwner } from "@/lib/notifications";
import { getInventoryLeadId, getMarketingLeadId } from "@/lib/guards";
import { OUTFLOW_REASON_LABELS } from "@/lib/merchandiseOutflowLabels";
import { PRICED_STATUSES, effectiveUnitCost } from "@/lib/purchases";

export { OUTFLOW_REASON_LABELS };

// Confirmado 2026-08-25: correlativo propio de Registro de Egresos
// (EG-0001, EG-0002...) — mismo patrón atómico que nextMerchandiseReentryNumber,
// una sola numeración para todo el módulo sin importar el motivo.
export async function nextMerchandiseOutflowNumber(): Promise<number> {
  const updated = await prisma.platformSettings.update({
    where: { id: "singleton" },
    data: { lastMerchandiseOutflowNumber: { increment: 1 } },
  });
  return updated.lastMerchandiseOutflowNumber;
}

export function formatMerchandiseOutflowCode(batchNumber: number): string {
  return `EG-${String(batchNumber).padStart(4, "0")}`;
}

// Confirmado 2026-08-25 (Fase 3): correlativo propio de Ventas Externas
// (VE-0001, VE-0002...) — mismo patrón atómico que los anteriores.
export async function nextExternalSaleNumber(): Promise<number> {
  const updated = await prisma.platformSettings.update({
    where: { id: "singleton" },
    data: { lastExternalSaleNumber: { increment: 1 } },
  });
  return updated.lastExternalSaleNumber;
}

export function formatExternalSaleCode(saleNumber: number): string {
  return `VE-${String(saleNumber).padStart(4, "0")}`;
}

// Nombre final a mostrarle a Daniel: el producto del catálogo si quedó
// vinculado, si no el nombre declarado (a mano o leído por IA sin confirmar).
export function outflowItemDisplayName(item: { declaredName: string; catalogItem: { name: string } | null }): string {
  return item.catalogItem?.name ?? item.declaredName;
}

// Confirmado 2026-08-25: enganche automático — en cuanto Daniel aprueba el
// retiro físico de una compra personal (ver confirm-inventory/route.ts), se
// crea solo este batch, ya "submitted", sin que nadie lo vuelva a capturar a
// mano. Un batch por ítem (no por orden completa), porque cada producto de
// la orden puede tener su propia cantidad/nombre confirmado.
export async function createOutflowForPersonalPurchaseItem(params: { itemId: string; productName: string; quantity: number }): Promise<void> {
  const batchNumber = await nextMerchandiseOutflowNumber();
  await prisma.merchandiseOutflowBatch.create({
    data: {
      code: formatMerchandiseOutflowCode(batchNumber),
      batchNumber,
      reason: "COMPRA_PERSONAL",
      submittedAt: new Date(),
      personalPurchaseItemId: params.itemId,
      items: { create: [{ declaredName: params.productName, quantity: params.quantity }] },
    },
  });
}

// CAMBIO_PROVEEDOR (confirmado 2026-08-26): al agregar un producto ya
// vinculado al catálogo, se busca sola la última compra REAL (mismo criterio
// que el historial de precios de Compras) hecha a ese proveedor por ese
// producto, para congelar cuánto se le pagó — así el crédito reclamable
// queda estimado sin que Daniel tenga que ir a buscarlo a Control de
// Compras. Null si nunca se le compró ese producto a ese proveedor.
export async function findMostRecentSupplierPurchase(supplierId: string, catalogItemId: string) {
  const req = await prisma.purchaseRequest.findFirst({
    where: { supplierId, catalogItemId, status: { in: PRICED_STATUSES } },
    orderBy: { requestedAt: "desc" },
    select: { id: true, unitCost: true, quantity: true, shippingIncluded: true, shippingCostTotal: true, requestedAt: true },
  });
  if (!req) return null;
  return { purchaseRequestId: req.id, unitCost: effectiveUnitCost(req), requestedAt: req.requestedAt };
}

// Avisa a Daniel que hay algo nuevo esperando en la cola de baja en Just —
// se llama cada vez que un batch queda "submitted" (despacho/garantía
// confirmados, deterioro dado de baja, o el enganche automático de compra
// personal), para que no dependa de que él entre a revisar por su cuenta.
// CAMBIO_PROVEEDOR queda afuera a propósito: lo captura el propio Daniel, no
// tiene sentido avisarle de algo que él mismo acaba de armar.
export async function notifyInventoryLeadOutflowPending(batch: { code: string; reason: string }): Promise<void> {
  if (batch.reason === "CAMBIO_PROVEEDOR") return;
  const leadId = await getInventoryLeadId();
  if (!leadId) return;
  await notifyOwner(leadId, {
    title: "Egreso pendiente de dar de baja en Just",
    body: `${batch.code} — ${OUTFLOW_REASON_LABELS[batch.reason] ?? batch.reason} listo para confirmar.`,
    url: "/area/workspace?tab=egresos&otab=baja",
  }).catch(() => null);
}

// Deterioro escalado a Compras (mercadería recién llegada) — por ahora solo
// avisa a Bryan con el detalle; el enganche real con "Reclamo posterior al
// cierre" / créditos con proveedor se conecta en una fase posterior, una vez
// ese modelo esté cerrado y comiteado.
export async function notifyMarketingLeadOutflowEscalated(item: { declaredName: string; quantity: number }): Promise<void> {
  const leadId = await getMarketingLeadId();
  if (!leadId) return;
  await notifyOwner(leadId, {
    title: "Deterioro escalado desde Inventario",
    body: `${item.declaredName} — ${item.quantity} un. recién llegadas, dañadas. Daniel pide gestionar crédito o cambio con el proveedor.`,
    url: "/area/workspace?tab=compras&ptab=urgentes",
  }).catch(() => null);
}
