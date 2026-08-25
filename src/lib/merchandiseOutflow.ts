import { prisma } from "@/lib/prisma";
import { notifyOwner } from "@/lib/notifications";
import { getInventoryLeadId, getMarketingLeadId } from "@/lib/guards";
import { OUTFLOW_REASON_LABELS } from "@/lib/merchandiseOutflowLabels";

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

// Avisa a Daniel que hay algo nuevo esperando en la cola de baja en Just —
// se llama cada vez que un batch queda "submitted" (despacho/garantía
// confirmados, deterioro dado de baja, o el enganche automático de compra
// personal), para que no dependa de que él entre a revisar por su cuenta.
export async function notifyInventoryLeadOutflowPending(batch: { code: string; reason: string }): Promise<void> {
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
