import crypto from "crypto";
import { prisma } from "@/lib/prisma";
import { isReportOpen } from "@/lib/purchaseUrgent";

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
  // Neto: lo que de verdad se le paga (grossCost − creditDeduction).
  totalCost: number;
  grossCost: number;
  creditDeduction: number;
  creditIds: string[];
  requestedAt: Date;
  // Confirmado 2026-09-15, pedido explícito del usuario: en el enlace
  // público de CHEN, quiere ver por cada pedido quién lo aprobó (Bryan,
  // PurchaseRequest.reviewedBy) y quién confirmó que llegó bien
  // (Daniel, receipt.approvedBy — "la aprobación final", ver schema.prisma).
  approvedByName: string | null;
  reviewedByName: string | null;
  // Confirmado 2026-09-17, pedido explícito del usuario: en el enlace
  // público de CHEN quiere ver, aparte de la fecha de solicitud, la fecha
  // en que Inventario lo confirmó de verdad (PurchaseRequestReceipt.approvedAt
  // — el mismo momento en que se generó la entrada en el Kardex de
  // INVESTOCK, ver StockKardexEntry) — esa es la fecha que le importa a
  // CHEN, no cuándo se pidió.
  receivedAt: Date | null;
  // Confirmado 2026-09-18, pedido explícito del usuario: en el panel interno
  // (admin) quiere ver, antes de pagar, la fecha/hora exacta y el nombre
  // completo de cada visto bueno — cuándo se aprobó la compra, y sobre todo
  // cuándo y quién (Bryan) confirmó que él sí autorizó esta deuda con CHEN.
  approvedAt: Date | null;
  buyerDebtConfirmedAt: Date | null;
  buyerDebtConfirmedByName: string | null;
  // Confirmado 2026-09-17, pedido explícito del usuario: misma foto que ya
  // se muestra en "falta enviar"/"ya despachado" — la última subida al
  // matricular el producto (PurchaseCatalogItem.photos).
  productImageUrl: string | null;
};

// Confirmado 2026-09-22, pedido explícito del usuario: en los dos enlaces
// públicos de CHEN solo aparecen solicitudes hechas desde el 21-sep-2026
// (medianoche de Guayaquil, UTC-5) — todo lo anterior queda únicamente en el
// panel interno (SupplierDebtPanel), que sigue mostrando todo para que nada
// viejo pendiente de pago se pierda.
export const SUPPLIER_PUBLIC_LINK_START = new Date("2026-09-21T05:00:00.000Z");

type ReportForDebtCheck = {
  damagedQty: number;
  missingQty: number;
  incompleteQty: number;
  differentQty: number;
  rejectedAt: Date | null;
  resolvedInternallyAt: Date | null;
  resolutions: {
    type: "CREDIT" | "REPLACEMENT" | "REFUND" | "WRITE_OFF";
    quantity: number;
    status: "PENDING" | "COMPLETED" | "CANCELLED";
    credit: { id: string; amount: number; status: string; appliedToGroupId: string | null } | null;
  }[];
};

const reportDebtInclude = {
  resolutions: {
    select: {
      type: true,
      quantity: true,
      status: true,
      credit: { select: { id: true, amount: true, status: true, appliedToGroupId: true } },
    },
  },
} as const;

// Confirmado 2026-09-22, pedido explícito del usuario: a un proveedor de
// crédito (hoy CHEN) solo se le paga lo que llegó COMPLETO y en BUEN ESTADO.
// Antes, un pedido con parte dañada/incompleta/distinta (ej. 100 pedidos, 10
// dañados) pasaba a RECEIVED en cuanto Daniel aprobaba los 90 buenos, y
// quedaba "listo para pagar" por los 100 aunque el reporte siguiera abierto.
// Ahora cualquier reporte todavía abierto — ni rechazado, ni resuelto
// internamente, ni cubierto al 100% por resoluciones COMPLETED (reemplazo que
// ya llegó, descuento, etc.) — retiene el pedido ENTERO hasta resolverse.
// Incluye reclamos tardíos (isLateClaim) mientras el pedido no esté pagado.
export function isReportBlockingDebtPayment(report: ReportForDebtCheck): boolean {
  if (report.rejectedAt || report.resolvedInternallyAt) return false;
  return isReportOpen(report, report.resolutions);
}

// Confirmado 2026-09-22, pedido explícito del usuario: si CHEN no repone y
// en cambio acepta descontar lo dañado (resolución CREDIT), se le paga SOLO
// lo bueno — el crédito se descuenta de ESTE pedido al pagarlo. Solo cuenta
// un crédito todavía AVAILABLE (uno ya usado en otra compra no se descuenta
// dos veces); al crear la tanda queda APPLIED con appliedToGroupId
// "TANDA:<id>" (ver payments/route.ts), y así se reconoce después al
// mostrar la tanda. REPLACEMENT (llegó el cambio) se paga completo; REFUND
// (ya nos devolvieron el dinero aparte) y WRITE_OFF (nosotros asumimos la
// pérdida) tampoco descuentan, para no descontar dos veces.
function availableCreditsForDebt(reports: ReportForDebtCheck[]): { id: string; amount: number }[] {
  return reports
    .filter((u) => !u.rejectedAt)
    .flatMap((u) => u.resolutions)
    .filter((res) => res.type === "CREDIT" && res.status === "COMPLETED" && res.credit?.status === "AVAILABLE")
    .map((res) => ({ id: res.credit!.id, amount: res.credit!.amount }));
}

export function tandaCreditMarker(debtPaymentId: string) {
  return `TANDA:${debtPaymentId}`;
}

// Descuento ya aplicado a un pedido dentro de una tanda — para mostrar la
// tanda con el mismo monto exacto que se pagó (ver tandaCreditMarker).
export function appliedTandaCreditDeduction(reports: ReportForDebtCheck[], debtPaymentId: string): number {
  const marker = tandaCreditMarker(debtPaymentId);
  const total = reports
    .flatMap((u) => u.resolutions)
    .filter((res) => res.type === "CREDIT" && res.credit?.status === "APPLIED" && res.credit.appliedToGroupId === marker)
    .reduce((s, res) => s + res.credit!.amount, 0);
  return Math.round(total * 100) / 100;
}

export const supplierDebtReportsInclude = { urgentReports: { include: reportDebtInclude } } as const;

// Confirmado 2026-09-08: lo que YA se puede sumar al saldo — recibido
// completo y en buen estado (RECEIVED), todavía no incluido en ninguna
// tanda (debtPaymentId null). Confirmado 2026-09-11: además, ya confirmado
// por quien aprueba compras (buyerDebtConfirmedAt) — ver comentario arriba.
// Confirmado 2026-09-22: y sin ningún reporte abierto
// (isReportBlockingDebtPayment); totalCost ya viene NETO de descuentos
// (creditDeduction), grossCost es el valor original del pedido.
export async function getSupplierDebtPendingItems(supplierId: string): Promise<SupplierDebtPendingItem[]> {
  const rows = await prisma.purchaseRequest.findMany({
    where: { supplierId, status: "RECEIVED", debtPaymentId: null, buyerDebtConfirmedAt: { not: null } },
    include: {
      catalogItem: { select: { name: true, photos: true } },
      reviewedBy: { select: { name: true } },
      receipt: { select: { approvedAt: true, approvedBy: { select: { name: true } } } },
      buyerDebtConfirmedBy: { select: { name: true } },
      urgentReports: { include: reportDebtInclude },
    },
    orderBy: { requestedAt: "asc" },
  });
  return rows.filter((r) => !r.urgentReports.some(isReportBlockingDebtPayment)).map((r) => {
    const credits = availableCreditsForDebt(r.urgentReports);
    const creditDeduction = Math.min(r.totalCost, Math.round(credits.reduce((s, c) => s + c.amount, 0) * 100) / 100);
    return {
    id: r.id,
    requestNumber: r.requestNumber,
    productName: r.catalogItem.name,
    quantity: r.quantity,
    totalCost: Math.round((r.totalCost - creditDeduction) * 100) / 100,
    grossCost: r.totalCost,
    creditDeduction,
    creditIds: credits.map((c) => c.id),
    requestedAt: r.requestedAt,
    approvedByName: r.reviewedBy?.name ?? null,
    reviewedByName: r.receipt?.approvedBy?.name ?? null,
    receivedAt: r.receipt?.approvedAt ?? null,
    approvedAt: r.reviewedAt,
    buyerDebtConfirmedAt: r.buyerDebtConfirmedAt,
    buyerDebtConfirmedByName: r.buyerDebtConfirmedBy?.name ?? null,
    productImageUrl: r.catalogItem.photos.at(-1) ?? null,
    };
  });
}

export type SupplierDebtPendingExcessItem = {
  id: string;
  requestId: string;
  requestNumber: number | null;
  productName: string;
  excessQty: number;
  amount: number;
  excessConfirmedAt: Date | null;
  excessConfirmedByName: string | null;
  productImageUrl: string | null;
  requestedAt: Date;
};

// Confirmado 2026-09-21: pedido explícito del usuario — el excedente (llegó
// más de lo pedido) SÍ se le paga al proveedor de crédito (hoy CHEN), en
// cuanto Bryan lo confirma real (excessConfirmedAt), al mismo costo unitario
// EXACTO de esa misma solicitud (request.unitCost × excessQty — nunca el
// costo efectivo con flete que usa el Kardex, ese flete no se le paga a
// CHEN). Nunca se crea una solicitud de compra nueva para esto: queda
// anclado al mismo requestId de siempre, con su propio estado de pago
// (excessDebtPaymentId) separado del de la solicitud base, para que uno
// pueda pagarse sin el otro sin nunca duplicar un pago.
export async function getSupplierDebtPendingExcessItems(supplierId: string): Promise<SupplierDebtPendingExcessItem[]> {
  const rows = await prisma.purchaseRequestUrgentReport.findMany({
    where: {
      excessQty: { gt: 0 },
      excessConfirmedAt: { not: null },
      excessDebtPaymentId: null,
      request: { supplierId },
    },
    include: {
      excessConfirmedBy: { select: { name: true } },
      request: {
        select: {
          requestNumber: true,
          unitCost: true,
          requestedAt: true,
          catalogItem: { select: { name: true, photos: true } },
          urgentReports: { include: reportDebtInclude },
        },
      },
    },
    orderBy: { excessConfirmedAt: "asc" },
  });
  // Confirmado 2026-09-22: mismo criterio que getSupplierDebtPendingItems —
  // si la solicitud ancla todavía tiene un reporte abierto (dañado,
  // incompleto, distinto), el excedente también espera.
  return rows.filter((r) => !r.request.urgentReports.some(isReportBlockingDebtPayment)).map((r) => ({
    id: r.id,
    requestId: r.requestId,
    requestNumber: r.request.requestNumber,
    productName: r.request.catalogItem.name,
    excessQty: r.excessQty,
    amount: Math.round(r.request.unitCost * r.excessQty * 100) / 100,
    excessConfirmedAt: r.excessConfirmedAt,
    excessConfirmedByName: r.excessConfirmedBy?.name ?? null,
    productImageUrl: r.request.catalogItem.photos.at(-1) ?? null,
    requestedAt: r.request.requestedAt,
  }));
}

export async function getSupplierDebtBalance(supplierId: string): Promise<number> {
  const [items, excessItems] = await Promise.all([
    getSupplierDebtPendingItems(supplierId),
    getSupplierDebtPendingExcessItems(supplierId),
  ]);
  return items.reduce((sum, i) => sum + i.totalCost, 0) + excessItems.reduce((sum, i) => sum + i.amount, 0);
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
  // Confirmado 2026-09-22: true cuando la parte buena ya se recibió
  // (RECEIVED) pero el pago del pedido entero queda retenido hasta que se
  // resuelva el reporte (ver isReportBlockingDebtPayment).
  paymentOnHold: boolean;
};

// Confirmado 2026-09-08: pedido explícito del usuario — lo incompleto,
// dañado o cambiado sigue visible en el documento (con su valor si se
// resolviera), pero NUNCA cuenta en el saldo. Se detecta por tener un
// PurchaseRequestUrgentReport sin resolver (reviewedByLeadAt null, o
// resuelto pero la resolución no cubrió el 100% — para Fase 1 se muestra
// mientras el reporte exista y la solicitud no haya llegado a RECEIVED).
//
// Confirmado 2026-09-21, bug real reportado por el usuario (Kit Pulidor de
// Uñas, SC-082 de CHEN): un reporte resuelto internamente
// (resolvedInternallyAt, ver resolve-internal/route.ts — solo pasa cuando
// era puramente un malentendido de conteo, ej. venía en bultos de más
// unidades cada uno, nunca faltó nada) o rechazado (rejectedAt) seguía
// contando como "en disputa" para siempre, aunque ya no había ningún
// problema real. Ahora solo un reporte SIN resolver (ni internamente ni
// rechazado) mantiene la solicitud en esta sección.
export async function getSupplierDebtDisputedItems(supplierId: string): Promise<SupplierDebtDisputedItem[]> {
  const rows = await prisma.purchaseRequest.findMany({
    where: {
      supplierId,
      // Confirmado 2026-09-22: también RECEIVED sin pagar — la parte buena ya
      // entró, pero el pedido entero queda retenido (y CHEN lo ve acá, con
      // el motivo) hasta que se resuelva lo dañado/incompleto/distinto.
      OR: [
        { status: { in: ["RECEIVED_PENDING_REVIEW", "APPROVED"] } },
        { status: "RECEIVED", debtPaymentId: null },
      ],
      urgentReports: { some: { resolvedInternallyAt: null, rejectedAt: null } },
    },
    include: {
      catalogItem: { select: { name: true } },
      urgentReports: { include: reportDebtInclude },
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
    .map((r) => ({
      ...r,
      urgentReports: r.urgentReports.filter((u) =>
        r.status === "RECEIVED" ? isReportBlockingDebtPayment(u) : u.resolvedInternallyAt === null && u.rejectedAt === null
      ),
    }))
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
        paymentOnHold: r.status === "RECEIVED",
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
//
// Confirmado 2026-09-21, mismo bug que getSupplierDebtDisputedItems: un
// pedido con SOLO reportes ya resueltos/rechazados exigía "none: {}" (cero
// reportes en total) para entrar acá, así que quedaba sin aparecer en
// ninguna sección — ya no estaba en disputa (con el fix de arriba) pero
// tampoco calificaba como "en camino". Ahora exige que no tenga NINGÚN
// reporte todavía abierto, sin importar si alguna vez tuvo uno que ya se
// cerró.
export async function getSupplierDebtInTransitItems(supplierId: string): Promise<SupplierDebtInTransitItem[]> {
  const openUrgentReport = { resolvedInternallyAt: null, rejectedAt: null } as const;
  const rows = await prisma.purchaseRequest.findMany({
    where: {
      supplierId,
      OR: [
        { status: "PENDING_APPROVAL" },
        { status: "APPROVED", urgentReports: { none: openUrgentReport } },
        { status: "RECEIVED_PENDING_REVIEW", urgentReports: { none: openUrgentReport } },
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
