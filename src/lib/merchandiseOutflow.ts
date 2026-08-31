import { prisma } from "@/lib/prisma";
import { notifyOwner } from "@/lib/notifications";
import { getInventoryLeadId, getMarketingLeadId, getFinanceLeadId } from "@/lib/guards";
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
export async function createOutflowForPersonalPurchaseItem(params: { itemId: string; productName: string; catalogItemId?: string | null; quantity: number }): Promise<void> {
  const batchNumber = await nextMerchandiseOutflowNumber();
  await prisma.merchandiseOutflowBatch.create({
    data: {
      code: formatMerchandiseOutflowCode(batchNumber),
      batchNumber,
      reason: "COMPRA_PERSONAL",
      submittedAt: new Date(),
      personalPurchaseItemId: params.itemId,
      items: { create: [{ catalogItemId: params.catalogItemId ?? undefined, declaredName: params.productName, quantity: params.quantity }] },
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

// Confirmado 2026-08-26, pedido explícito del usuario: quien resuelve un
// producto de CAMBIO_PROVEEDOR (cambio o crédito, y sube el comprobante) es
// quien solicitó ORIGINALMENTE esa compra a ese proveedor
// (linkedPurchaseRequest.requestedById) — no Daniel ni un rol fijo. Si el
// producto no tiene compra vinculada (nombre a mano, o nunca se le compró
// antes a ese proveedor) o quien la pidió ya no existe, Bryan (líder de
// Análisis de Mercado) es el responsable de respaldo — "por ahora", el
// usuario ya avisó que esto lo hará otra persona más adelante. Daniel y
// admin quedan siempre en modo lectura sobre esta resolución (ver
// canViewSupplierExchangeResolution en MerchandiseOutflowPanel).
export async function resolveOutflowItemGestorId(item: { linkedPurchaseRequest: { requestedById: string | null } | null }): Promise<string | null> {
  if (item.linkedPurchaseRequest?.requestedById) return item.linkedPurchaseRequest.requestedById;
  return getMarketingLeadId();
}

// Se llama al dejar lista una solicitud de CAMBIO_PROVEEDOR — agrupa los
// ítems por gestor (para no mandar una notificación por producto si la
// misma persona tiene varios en el mismo paquete) y avisa a cada quien que
// tiene que negociar con el proveedor. Apunta a una página propia dentro de
// /area (no una pestaña de Registro de Egresos) porque el gestor puede no
// tener ningún otro acceso a ese módulo — mismo criterio que
// /area/compras-personales (solo requiere ser colaborador activo, sin permiso
// de departamento).
export async function notifySupplierExchangeGestors(batch: {
  code: string;
  supplier: { name: string } | null;
  items: { quantity: number; declaredName: string; catalogItem: { name: string } | null; linkedPurchaseRequest: { requestedById: string | null } | null }[];
}): Promise<void> {
  const byGestor = new Map<string, number>();
  for (const item of batch.items) {
    const gestorId = await resolveOutflowItemGestorId(item);
    if (!gestorId) continue;
    byGestor.set(gestorId, (byGestor.get(gestorId) ?? 0) + 1);
  }
  await Promise.all(
    Array.from(byGestor.entries()).map(([gestorId, count]) =>
      notifyOwner(gestorId, {
        title: "Cambio con proveedor pendiente de tu gestión",
        body: `${batch.code} — ${count} producto(s) de ${batch.supplier?.name ?? "un proveedor"} esperan que negocies el cambio o crédito.`,
        url: "/area/workspace?tab=egresos&otab=proveedor",
      }).catch(() => null)
    )
  );
}

// Confirmado 2026-08-27, pedido explícito del usuario: si el proveedor
// rechaza tanto el cambio como el crédito (resolution REJECTED), es una
// pérdida real. Confirmado 2026-08-28: el flujo pasó a ser secuencial —
// Daniel confirma primero la baja en Just, y SOLO ENTONCES se le avisa a
// Nairoby para que dé de baja financieramente (ver
// notifySupplierExchangeJustWriteOffConfirmed más abajo, disparada desde
// just-writeoff-confirm/route.ts). Acá solo avisa a admin (revisar y
// opcionalmente comentar, ver adminReviewedAt) y a Daniel (confirmar la
// baja en Just, primer paso de la cadena).
export async function notifySupplierExchangeRejected(item: {
  quantity: number;
  declaredName: string;
  catalogItem: { name: string } | null;
  batch: { code: string; supplier: { name: string } | null };
}): Promise<void> {
  const name = item.catalogItem?.name ?? item.declaredName;
  const supplierName = item.batch.supplier?.name ?? "un proveedor";
  const [inventoryLeadId, invDept] = await Promise.all([
    getInventoryLeadId(),
    prisma.department.findUnique({ where: { code: "INV" }, select: { id: true } }),
  ]);
  // "Registro de Egresos" (donde admin ve esto en modo lectura) solo se ve
  // desde la página del departamento INV — ver canViewMerchandiseOutflow en
  // admin/dept/[id]/page.tsx.
  const adminUrl = invDept ? `/admin/dept/${invDept.id}?tab=egresos&otab=proveedor` : "/admin";

  const notifications: Promise<void>[] = [
    notifyOwner("admin", {
      title: "⚠️ Proveedor rechazó un cambio con mercadería",
      body: `${supplierName} no cambia ni da crédito por "${name}" (${item.quantity} un.) — ${item.batch.code}. Riesgo de perder la mercadería y el pago.`,
      url: adminUrl,
    }),
  ];
  if (inventoryLeadId) {
    notifications.push(
      notifyOwner(inventoryLeadId, {
        title: "Mercadería rechazada por proveedor — confirmar baja en Just",
        body: `${supplierName} — "${name}" (${item.quantity} un.) — ${item.batch.code}.`,
        url: "/area/workspace?tab=egresos&otab=proveedor",
      })
    );
  }
  await Promise.all(notifications.map((p) => p.catch(() => null)));
}

// Confirmado 2026-08-28, pedido explícito del usuario: recién cuando Daniel
// confirma la baja en Just le llega el aviso a Nairoby — antes de eso ella
// no tiene nada que hacer acá (ver justWriteOffConfirmedAt requerido en
// finance-writeoff/route.ts).
export async function notifySupplierExchangeJustWriteOffConfirmed(item: {
  quantity: number;
  declaredName: string;
  catalogItem: { name: string } | null;
  batch: { code: string; supplier: { name: string } | null };
}): Promise<void> {
  const name = item.catalogItem?.name ?? item.declaredName;
  const supplierName = item.batch.supplier?.name ?? "un proveedor";
  const financeLeadId = await getFinanceLeadId();
  if (!financeLeadId) return;
  await notifyOwner(financeLeadId, {
    title: "Mercadería rechazada por proveedor — dar de baja financiera",
    body: `${supplierName} — "${name}" (${item.quantity} un.) — ${item.batch.code}. Daniel ya confirmó la baja en Just.`,
    url: "/area/workspace?tab=egresos&otab=proveedor",
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
