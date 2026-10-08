import type { Prisma } from "@/generated/prisma/client";
import { prisma } from "@/lib/prisma";
import { sendPushToOwner } from "@/lib/webPush";
import { SUPPLIER_PUBLIC_LINK_START } from "@/lib/supplierDebt";

// Confirmado 2026-09-23, pedido explícito del usuario: el equipo de
// despacho de CHEN (quien abre el enlace "solo envíos",
// /proveedor-ledger/envios/[token]) puede activar notificaciones push en su
// celular/laptop para enterarse de cada pedido nuevo sin tener que entrar al
// enlace a revisar. No tienen cuenta en DAFLOW, así que sus suscripciones se
// guardan en PushSubscription bajo un ownerId sentinel por proveedor (mismo
// patrón sin FK que "admin"). Al regenerar el enlace se borran todas (ver
// shipping-link/route.ts) — quien tenía el enlace viejo deja de recibir.
export function supplierShippingPushOwnerId(supplierId: string) {
  return `supplier-shipping:${supplierId}`;
}

export function isSupplierShippingPushOwnerId(ownerId: string) {
  return ownerId.startsWith("supplier-shipping:");
}

// Filtro único de "Falta enviar" — lo usan los dos enlaces de CHEN y el
// número de los avisos push, para que siempre coincidan.
// Confirmado 2026-09-30, pedido explícito del usuario: si el equipo de
// Inventario ya recibió el pedido (hay recepción o reporte urgente), deja de
// estar "por enviar" aunque CHEN nunca haya apretado "Ya lo enviamos" — llegó,
// así que obviamente lo enviaron. No desaparece sin rastro (el problema del
// 2026-09-17): pasa al historial marcado "Recibido en bodega TBS"
// (supplierShipmentHistoryWhere).
export function supplierPendingShipmentWhere(supplierId: string) {
  return {
    supplierId,
    status: { notIn: ["PENDING_APPROVAL", "REJECTED", "RECEIVED_PENDING_REVIEW", "RECEIVED"] },
    supplierShippingConfirmedAt: null,
    receipt: { is: null },
    urgentReports: { none: {} },
    requestedAt: { gte: SUPPLIER_PUBLIC_LINK_START },
  } satisfies Prisma.PurchaseRequestWhereInput;
}

// Historial: lo que CHEN confirmó que envió + lo que nuestra bodega ya
// recibió sin que ellos lo confirmaran (ver arriba).
export function supplierShipmentHistoryWhere(supplierId: string) {
  return {
    supplierId,
    requestedAt: { gte: SUPPLIER_PUBLIC_LINK_START },
    OR: [
      { supplierShippingConfirmedAt: { not: null } },
      {
        status: { notIn: ["PENDING_APPROVAL", "REJECTED"] },
        OR: [{ receipt: { isNot: null } }, { urgentReports: { some: {} } }, { status: { in: ["RECEIVED_PENDING_REVIEW", "RECEIVED"] } }],
      },
    ],
  } satisfies Prisma.PurchaseRequestWhereInput;
}

// Fecha y etiqueta de cada fila del historial: la confirmación de CHEN si
// la hubo; si no, cuándo la recibió nuestra bodega.
export const supplierShipmentHistoryInclude = {
  receipt: { select: { confirmedAt: true } },
  urgentReports: { select: { reportedAt: true }, orderBy: { reportedAt: "asc" }, take: 1 },
} as const;

export function supplierShipmentHistoryRow(r: {
  supplierShippingConfirmedAt: Date | null;
  requestedAt: Date;
  receipt: { confirmedAt: Date } | null;
  urgentReports: { reportedAt: Date }[];
  status: string;
}) {
  // Confirmado 2026-10-08, pedido del usuario: si CHEN sí confirmó y además
  // ya llegó a bodega, también sale "Recibido en bodega TBS" (verde más claro).
  const receivedAtWarehouse = !!r.receipt || r.urgentReports.length > 0 || r.status === "RECEIVED_PENDING_REVIEW" || r.status === "RECEIVED";
  if (r.supplierShippingConfirmedAt) return { confirmedAt: r.supplierShippingConfirmedAt.toISOString(), receivedWithoutConfirm: false, receivedAtWarehouse };
  const receivedAt = r.receipt?.confirmedAt ?? r.urgentReports[0]?.reportedAt ?? r.requestedAt;
  return { confirmedAt: receivedAt.toISOString(), receivedWithoutConfirm: true, receivedAtWarehouse: true };
}

export async function countSupplierPendingShipments(supplierId: string) {
  return prisma.purchaseRequest.count({ where: supplierPendingShipmentWhere(supplierId) });
}

function pendingLabel(n: number) {
  return n === 1 ? "1 pedido por enviar" : `${n} pedidos por enviar`;
}

// Se llama justo después de que Bryan (o el admin, en emergencia) aprueba
// una solicitud de un proveedor de crédito. Nunca debe tumbar la
// aprobación — cualquier error queda solo en el log.
export async function notifySupplierShippingTeamOfNewOrders(
  supplierId: string,
  lines: { name: string; quantity: number }[]
) {
  try {
    const supplier = await prisma.supplier.findUnique({
      where: { id: supplierId },
      select: { paymentMode: true, publicShippingToken: true },
    });
    if (!supplier || supplier.paymentMode !== "CREDITO" || !supplier.publicShippingToken) return;

    const pending = await countSupplierPendingShipments(supplierId);
    const items = lines.map((l) => `${l.name} (${l.quantity} u.)`).join(", ");
    await sendPushToOwner(
      supplierShippingPushOwnerId(supplierId),
      {
        title: lines.length === 1 ? "Nuevo pedido por enviar" : `${lines.length} pedidos nuevos por enviar`,
        body: `${items}. En total tienen ${pendingLabel(pending)}.`,
        url: `/proveedor-ledger/envios/${supplier.publicShippingToken}`,
      },
      { brandIcon: false }
    );
  } catch (err) {
    console.error("notifySupplierShippingTeamOfNewOrders falló:", err);
  }
}

// Recordatorio diario (cron push-pendientes, 8:00 Guayaquil): solo si
// todavía queda algo por enviar y alguien del proveedor activó los avisos.
export async function sendSupplierShippingDailyReminders() {
  const suppliers = await prisma.supplier.findMany({
    where: { paymentMode: "CREDITO", publicShippingToken: { not: null } },
    select: { id: true, publicShippingToken: true },
  });
  let sent = 0;
  for (const s of suppliers) {
    const ownerId = supplierShippingPushOwnerId(s.id);
    const hasSubs = await prisma.pushSubscription.count({ where: { ownerId } });
    if (!hasSubs) continue;
    const pending = await countSupplierPendingShipments(s.id);
    if (pending === 0) continue;
    await sendPushToOwner(
      ownerId,
      {
        title: "Pedidos pendientes de envío",
        body: `Todavía tienen ${pendingLabel(pending)}. Cuando despachen, aprieten “Ya lo enviamos”.`,
        url: `/proveedor-ledger/envios/${s.publicShippingToken}`,
      },
      { brandIcon: false }
    );
    sent++;
  }
  return sent;
}
