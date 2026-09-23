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

// Mismo filtro exacto que "Falta enviar" en envios/[token]/page.tsx — el
// número del aviso tiene que coincidir con lo que ven al abrir el enlace.
export async function countSupplierPendingShipments(supplierId: string) {
  return prisma.purchaseRequest.count({
    where: {
      supplierId,
      status: { notIn: ["PENDING_APPROVAL", "REJECTED"] },
      supplierShippingConfirmedAt: null,
      requestedAt: { gte: SUPPLIER_PUBLIC_LINK_START },
    },
  });
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
