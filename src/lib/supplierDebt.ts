import crypto from "crypto";
import { prisma } from "@/lib/prisma";

// Confirmado 2026-09-15: busca el proveedor de crédito dueño de este token
// de enlace público — primero por coincidencia directa (formato actual,
// desde que se guarda el token tal cual para poder mostrarlo siempre en el
// panel de admin), y si no, por el hash del formato viejo (para que un
// enlace generado ANTES de este cambio siga funcionando sin regenerarlo).
export async function findSupplierByPublicLedgerToken(token: string) {
  const tokenHash = crypto.createHash("sha256").update(token).digest("hex");
  return prisma.supplier.findFirst({
    where: { OR: [{ publicLedgerToken: token }, { publicLedgerTokenHash: tokenHash }] },
  });
}

// Confirmado 2026-09-17, pedido explícito del usuario: un segundo enlace,
// llave completamente aparte del de arriba, para que el proveedor de
// crédito (hoy solo CHEN) se lo pase a SU PROPIO equipo de despacho — ve
// únicamente "lo que falta enviar" (ver /proveedor-ledger/envios/[token]),
// nunca el saldo/deuda. A propósito NO cae en el fallback del token de
// arriba: aunque alguien edite la URL, esta llave nunca abre la página del
// saldo, y la de arriba nunca abre esta.
export async function findSupplierByPublicShippingToken(token: string) {
  return prisma.supplier.findFirst({ where: { publicShippingToken: token } });
}

// Usado solo por las rutas de subida de foto de envío (upload-sign y
// requests/[id]/photo) — ahí sí da igual con cuál de los dos enlaces entró
// el proveedor, porque subir una foto de lo que está enviando no expone
// nada financiero.
export async function findSupplierByAnySupplierLedgerToken(token: string) {
  const byLedger = await findSupplierByPublicLedgerToken(token);
  if (byLedger) return byLedger;
  return findSupplierByPublicShippingToken(token);
}

// Fase 1 (proveedores con crédito, hoy solo CHEN) — confirmado 2026-09-08:
// el saldo que se le debe a un proveedor de crédito NUNCA se "hace a mano" —
// es la suma de lo que ya pasó por el filtro completo: Jariel solicita →
// Bryan aprueba → Daniel confirma que llegó completo y en buen estado
// (status RECEIVED) y todavía no se pagó (debtPaymentId null). Nada más
// cuenta para el total.
//
// Confirmado 2026-09-11: pedido explícito del usuario — se agregó un
// candado más, específico de esto (no de la recepción en sí, que sigue
// sin cambios): además de RECEIVED, hace falta que quien aprueba compras
// (hoy Bryan, canActOnPurchaseApproval) confirme APARTE que él sí autorizó
// esa compra (PurchaseRequest.buyerDebtConfirmedAt) — evita pagarle a CHEN
// por algo que llegó sin haber sido pedido/aprobado de verdad. Ver
// /api/purchase-requests/credit-debt-pending y .../[id]/confirm-debt.

export async function nextSupplierDebtPaymentNumber(): Promise<number> {
  const updated = await prisma.platformSettings.update({
    where: { id: "singleton" },
    data: { lastSupplierDebtPaymentNumber: { increment: 1 } },
  });
  return updated.lastSupplierDebtPaymentNumber;
}

export function formatSupplierDebtPaymentCode(n: number): string {
  return `TND-${String(n).padStart(4, "0")}`;
}

export type SupplierDebtPendingItem = {
  id: string;
  requestNumber: number | null;
  productName: string;
  quantity: number;
  totalCost: number;
  requestedAt: Date;
  // Confirmado 2026-09-15, pedido explícito del usuario: en el enlace
  // público de CHEN, quiere ver por cada pedido quién lo aprobó (Bryan,
  // PurchaseRequest.reviewedBy) y quién confirmó que llegó bien
  // (Daniel, receipt.approvedBy — "la aprobación final", ver schema.prisma).
  approvedByName: string | null;
  reviewedByName: string | null;
};

// Confirmado 2026-09-08: lo que YA se puede sumar al saldo — recibido
// completo y en buen estado (RECEIVED), todavía no incluido en ninguna
// tanda (debtPaymentId null). Confirmado 2026-09-11: además, ya confirmado
// por quien aprueba compras (buyerDebtConfirmedAt) — ver comentario arriba.
export async function getSupplierDebtPendingItems(supplierId: string): Promise<SupplierDebtPendingItem[]> {
  const rows = await prisma.purchaseRequest.findMany({
    where: { supplierId, status: "RECEIVED", debtPaymentId: null, buyerDebtConfirmedAt: { not: null } },
    include: {
      catalogItem: { select: { name: true } },
      reviewedBy: { select: { name: true } },
      receipt: { select: { approvedBy: { select: { name: true } } } },
    },
    orderBy: { requestedAt: "asc" },
  });
  return rows.map((r) => ({
    id: r.id,
    requestNumber: r.requestNumber,
    productName: r.catalogItem.name,
    quantity: r.quantity,
    totalCost: r.totalCost,
    requestedAt: r.requestedAt,
    approvedByName: r.reviewedBy?.name ?? null,
    reviewedByName: r.receipt?.approvedBy?.name ?? null,
  }));
}

export async function getSupplierDebtBalance(supplierId: string): Promise<number> {
  const items = await getSupplierDebtPendingItems(supplierId);
  return items.reduce((sum, i) => sum + i.totalCost, 0);
}

export type BuyerDebtConfirmationItem = {
  id: string;
  requestNumber: number | null;
  productName: string;
  supplierName: string;
  quantity: number;
  totalCost: number;
  requestedAt: Date;
};

// Confirmado 2026-09-11: cola de Bryan (canActOnPurchaseApproval) — todo lo
// ya RECEIVED de un proveedor de crédito que todavía no confirmó ni
// rechazó. Cruza todos los proveedores CREDITO, no solo CHEN, para cuando
// haya más de uno.
export async function getBuyerDebtConfirmationQueue(): Promise<BuyerDebtConfirmationItem[]> {
  const rows = await prisma.purchaseRequest.findMany({
    where: {
      status: "RECEIVED",
      debtPaymentId: null,
      buyerDebtConfirmedAt: null,
      buyerDebtRejectedAt: null,
      supplier: { paymentMode: "CREDITO" },
    },
    include: { catalogItem: { select: { name: true } }, supplier: { select: { name: true } } },
    orderBy: { requestedAt: "asc" },
  });
  return rows.map((r) => ({
    id: r.id,
    requestNumber: r.requestNumber,
    productName: r.catalogItem.name,
    supplierName: r.supplier.name,
    quantity: r.quantity,
    totalCost: r.totalCost,
    requestedAt: r.requestedAt,
  }));
}

export type SupplierDebtDisputedItem = {
  id: string;
  requestNumber: number | null;
  productName: string;
  quantity: number;
  wouldBeValue: number;
  damagedQty: number;
  incompleteQty: number;
  differentQty: number;
  requestedAt: Date;
  approvedByName: string | null;
  reviewedByName: string | null;
};

// Confirmado 2026-09-08: pedido explícito del usuario — lo incompleto,
// dañado o cambiado sigue visible en el documento (con su valor si se
// resolviera), pero NUNCA cuenta en el saldo. Se detecta por tener un
// PurchaseRequestUrgentReport sin resolver (reviewedByLeadAt null, o
// resuelto pero la resolución no cubrió el 100% — para Fase 1 se muestra
// mientras el reporte exista y la solicitud no haya llegado a RECEIVED).
export async function getSupplierDebtDisputedItems(supplierId: string): Promise<SupplierDebtDisputedItem[]> {
  const rows = await prisma.purchaseRequest.findMany({
    where: {
      supplierId,
      status: { in: ["RECEIVED_PENDING_REVIEW", "APPROVED"] },
      urgentReports: { some: {} },
    },
    include: {
      catalogItem: { select: { name: true } },
      urgentReports: true,
      reviewedBy: { select: { name: true } },
      // Confirmado 2026-09-15: un pedido en disputa todavía no llegó a
      // RECEIVED (la aprobación final de Daniel es justo lo que falta), pero
      // sí puede ya tener un receipt (RECEIVED_PENDING_REVIEW) con quien lo
      // recibió físicamente — se muestra ese en vez de dejarlo vacío.
      receipt: { select: { confirmedBy: { select: { name: true } } } },
    },
    orderBy: { requestedAt: "asc" },
  });
  return rows
    .filter((r) => r.urgentReports.length > 0)
    .map((r) => {
      const damagedQty = r.urgentReports.reduce((s, u) => s + u.damagedQty, 0);
      const incompleteQty = r.urgentReports.reduce((s, u) => s + u.incompleteQty, 0);
      const differentQty = r.urgentReports.reduce((s, u) => s + u.differentQty, 0);
      return {
        id: r.id,
        requestNumber: r.requestNumber,
        productName: r.catalogItem.name,
        quantity: r.quantity,
        wouldBeValue: r.totalCost,
        damagedQty,
        incompleteQty,
        differentQty,
        requestedAt: r.requestedAt,
        approvedByName: r.reviewedBy?.name ?? null,
        reviewedByName: r.receipt?.confirmedBy?.name ?? null,
      };
    });
}

export type SupplierDebtInTransitItem = {
  id: string;
  requestNumber: number | null;
  productName: string;
  quantity: number;
  totalCost: number;
  requestedAt: Date;
  statusLabel: string;
};

// Confirmado 2026-09-15, pedido explícito del usuario: quiere trazabilidad
// COMPLETA de todo lo que tiene con un proveedor de crédito, no solo lo
// pagable (getSupplierDebtPendingItems) y lo en disputa
// (getSupplierDebtDisputedItems) — un pedido que Bryan ya aprobó pero que
// CHEN todavía no envió, o que Inventario ya recibió pero Daniel/Bryan
// todavía no terminan de confirmar, antes no aparecía en ningún lado de
// esta pantalla. Excluye lo que ya cuenta en otra sección (pagable, en
// disputa, ya en una tanda) para no duplicar nada.
export async function getSupplierDebtInTransitItems(supplierId: string): Promise<SupplierDebtInTransitItem[]> {
  const rows = await prisma.purchaseRequest.findMany({
    where: {
      supplierId,
      OR: [
        { status: "PENDING_APPROVAL" },
        { status: "APPROVED", urgentReports: { none: {} } },
        { status: "RECEIVED_PENDING_REVIEW", urgentReports: { none: {} } },
        { status: "RECEIVED", buyerDebtConfirmedAt: null, buyerDebtRejectedAt: null, debtPaymentId: null },
        { status: "RECEIVED", buyerDebtRejectedAt: { not: null } },
      ],
    },
    include: { catalogItem: { select: { name: true } } },
    orderBy: { requestedAt: "asc" },
  });
  return rows.map((r) => ({
    id: r.id,
    requestNumber: r.requestNumber,
    productName: r.catalogItem.name,
    quantity: r.quantity,
    totalCost: r.totalCost,
    requestedAt: r.requestedAt,
    statusLabel:
      r.status === "PENDING_APPROVAL"
        ? "Esperando aprobación de Bryan"
        : r.status === "APPROVED"
          ? "Aprobado — esperando que llegue"
          : r.status === "RECEIVED_PENDING_REVIEW"
            ? "Recibido — esperando aprobación final de Daniel"
            : r.buyerDebtRejectedAt
              ? "Bryan dijo que no autorizó esto — revisar con CHEN"
              : "Recibido y aprobado — esperando confirmación de Bryan",
  }));
}

// Confirmado 2026-09-08: mismo espíritu que findDuplicatePaymentProofUse en
// purchases.ts — un número de comprobante nunca se reutiliza entre
// transferencias de tandas distintas.
export async function findDuplicateDebtComprobante(
  comprobanteNumber: string,
  excludeDebtPaymentId?: string
): Promise<{ debtPaymentCode: string } | null> {
  const trimmed = comprobanteNumber.trim();
  if (!trimmed) return null;
  const dup = await prisma.supplierDebtTransfer.findFirst({
    where: {
      comprobanteNumber: trimmed,
      ...(excludeDebtPaymentId ? { debtPaymentId: { not: excludeDebtPaymentId } } : {}),
    },
    include: { debtPayment: { select: { code: true } } },
  });
  return dup ? { debtPaymentCode: dup.debtPayment.code } : null;
}
