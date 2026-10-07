import { z } from "zod";
import { prisma } from "@/lib/prisma";
import type { Prisma, PurchaseRequestStatus } from "@/generated/prisma/client";
import { getAvailableCreditsForSupplier } from "@/lib/supplierCredits";

// Estados que cuentan como "compra real" para el historial de precio — no
// las que todavía están pendientes de aprobar (no son un precio confirmado
// todavía) ni las rechazadas.
export const PRICED_STATUSES: PurchaseRequestStatus[] = ["APPROVED", "PAID", "RECEIVED"];

// Confirmado 2026-08-05: código correlativo para toda solicitud de compra
// (SC-001, SC-002...) — una sola numeración compartida por TODO el módulo,
// sin importar quién la suba (hoy Nairoby o Bryan) — para la auditoría
// semestral de Finanzas. Se asigna UNA vez por grupo (no por fila), vía el
// contador único en PlatformSettings, incrementado dentro de una transacción
// para que nunca se repita aunque lleguen dos solicitudes al mismo tiempo.
export async function nextPurchaseRequestNumber(): Promise<number> {
  const updated = await prisma.platformSettings.update({
    where: { id: "singleton" },
    data: { lastPurchaseRequestNumber: { increment: 1 } },
  });
  return updated.lastPurchaseRequestNumber;
}

export function formatPurchaseRequestCode(requestNumber: number): string {
  return `SC-${String(requestNumber).padStart(3, "0")}`;
}

// Solicitud de compra todavía en camino (no rechazada, no ingresada al Kardex).
export const OPEN_PURCHASE_STATUSES = ["PENDING_APPROVAL", "APPROVED", "PAID", "RECEIVED_PENDING_REVIEW"] as const;

const OPEN_STATUS_TEXT: Record<string, string> = {
  PENDING_APPROVAL: "esperando aprobación",
  APPROVED: "aprobada",
  PAID: "pagada, en camino",
  RECEIVED_PENDING_REVIEW: "llegó, en revisión",
  RECEIVED: "llegó, falta que entre al Kardex",
};

// Las compras recibidas antes de esto no tienen línea propia en el Kardex:
// su stock entró con el saldo inicial de INVESTOCK (verificado 2026-09-29,
// la primera compra en el Kardex es del 2026-09-09 a las 20:01 UTC).
const KARDEX_PURCHASES_START = new Date("2026-09-09T20:00:00Z");

// Confirmado 2026-09-29, pedido del usuario: una compra sigue "abierta"
// hasta que su stock entra de verdad al Kardex — también si ya se recibió
// pero todavía no entró (ej. producto nuevo esperando su ID de Dropi). Si no,
// el producto parece sin stock y otra persona lo compraría otra vez.
export function openPurchaseWhere(): Prisma.PurchaseRequestWhereInput {
  return {
    OR: [
      { status: { in: [...OPEN_PURCHASE_STATUSES] } },
      { status: "RECEIVED", receipt: { approvedAt: { gte: KARDEX_PURCHASES_START }, stockKardexEntry: null } },
    ],
  };
}

// Pedido del usuario 2026-09-30 (Bryan, casco SC-124): códigos SC de las
// compras abiertas por producto — Heidy ve "Compra en camino" en los que
// todavía tiene que publicar en Dropi.
export async function getOpenPurchaseCodesByCatalogItem(catalogItemIds: string[]): Promise<Map<string, string[]>> {
  const out = new Map<string, string[]>();
  if (catalogItemIds.length === 0) return out;
  const rows = await prisma.purchaseRequest.findMany({
    where: { catalogItemId: { in: catalogItemIds }, AND: [openPurchaseWhere()] },
    orderBy: { createdAt: "asc" },
    select: { catalogItemId: true, requestNumber: true },
  });
  for (const r of rows) {
    const code = r.requestNumber ? formatPurchaseRequestCode(r.requestNumber) : "sin código";
    const list = out.get(r.catalogItemId) ?? [];
    if (!list.includes(code)) list.push(code);
    out.set(r.catalogItemId, list);
  }
  return out;
}

export type OtherOpenPurchase ={ catalogItemId: string; itemName: string; code: string; quantity: number; requesterName: string; statusText: string; createdAt: string; recent: boolean };

// Pedido del usuario 2026-10-07 (luces navideñas: Jariel recibió SC-149 y
// una hora después Nairoby pidió SC-162): el freno también vale aunque la
// compra de la otra persona ya haya llegado, estos días desde que la pidió
// o desde que entró a bodega.
export const RECENT_PURCHASE_BLOCK_DAYS = 3;

// Confirmado 2026-09-29, pedido del usuario: evitar que Jariel y Nairoby
// compren el mismo producto sin saber que el otro ya lo está comprando.
// Mientras haya una compra abierta de un producto (o una de los últimos
// RECENT_PURCHASE_BLOCK_DAYS días), solo quien la pidió puede pedir más de
// ese producto; cualquier otra persona queda frenada y ve quién lo está
// comprando. El admin no se frena.
export async function findOpenPurchasesByOthers(catalogItemIds: string[], requesterId: string | null, db: Prisma.TransactionClient = prisma): Promise<OtherOpenPurchase[]> {
  if (catalogItemIds.length === 0) return [];
  const since = new Date(Date.now() - RECENT_PURCHASE_BLOCK_DAYS * 24 * 60 * 60 * 1000);
  const recentWhere: Prisma.PurchaseRequestWhereInput = {
    status: { not: "REJECTED" },
    OR: [{ createdAt: { gte: since } }, { receipt: { approvedAt: { gte: since } } }],
  };
  const rows = await db.purchaseRequest.findMany({
    where: {
      catalogItemId: { in: catalogItemIds },
      AND: [{ OR: [openPurchaseWhere(), recentWhere] }, ...(requesterId ? [{ OR: [{ requestedById: null }, { requestedById: { not: requesterId } }] }] : [])],
    },
    orderBy: { createdAt: "desc" },
    select: {
      catalogItemId: true,
      requestNumber: true,
      quantity: true,
      status: true,
      createdAt: true,
      catalogItem: { select: { name: true } },
      requestedBy: { select: { name: true } },
      receipt: { select: { approvedAt: true, stockKardexEntry: { select: { id: true } } } },
    },
  });
  // Misma regla que openPurchaseWhere(): sigue abierta hasta entrar al Kardex.
  const isOpen = (r: (typeof rows)[number]) =>
    (OPEN_PURCHASE_STATUSES as readonly string[]).includes(r.status) ||
    (r.status === "RECEIVED" && !!r.receipt?.approvedAt && r.receipt.approvedAt >= KARDEX_PURCHASES_START && !r.receipt.stockKardexEntry);
  // Primero las que siguen en camino.
  return rows
    .map((r) => ({
      catalogItemId: r.catalogItemId,
      itemName: r.catalogItem.name,
      code: r.requestNumber ? formatPurchaseRequestCode(r.requestNumber) : "sin código",
      quantity: r.quantity,
      requesterName: r.requestedBy?.name ?? "el admin",
      statusText: isOpen(r) ? OPEN_STATUS_TEXT[r.status] ?? "abierta" : "ya llegó y está en stock",
      createdAt: r.createdAt.toISOString(),
      recent: !isOpen(r),
    }))
    .sort((a, b) => Number(a.recent) - Number(b.recent));
}

// Pedido del usuario 2026-10-05: cerrar del todo el caso de dos personas
// enviando la compra del mismo producto en el mismo segundo (las dos pasaban
// el chequeo de arriba antes de que la otra quedara guardada). Se llama
// DENTRO de la transacción que crea las solicitudes: pone un candado de la
// base por producto (se suelta solo al terminar la transacción) y vuelve a
// revisar — la segunda espera a que la primera termine y ya la ve.
// requesterId null = admin: se bloquea igual, pero no se frena.
export async function lockAndFindOpenPurchaseByOthers(tx: Prisma.TransactionClient, catalogItemIds: string[], requesterId: string | null): Promise<OtherOpenPurchase | null> {
  for (const id of [...new Set(catalogItemIds)].sort()) {
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${"purchase-item:" + id}))`;
  }
  if (!requesterId) return null;
  const others = await findOpenPurchasesByOthers(catalogItemIds, requesterId, tx);
  return others[0] ?? null;
}

export function otherOpenPurchaseMessage(p: OtherOpenPurchase): string {
  const day = new Date(p.createdAt).toLocaleDateString("es-EC", { day: "numeric", month: "short", timeZone: "America/Guayaquil" });
  if (p.recent) {
    return `${p.requesterName} ya compró "${p.itemName}" hace poco: ${p.code}, ${p.quantity} u., pedida el ${day} (${p.statusText}). Nadie más puede comprarlo hasta ${RECENT_PURCHASE_BLOCK_DAYS} días después de esa compra. Si hace falta más, habla con ${p.requesterName}.`;
  }
  return `${p.requesterName} ya está comprando "${p.itemName}": ${p.code}, ${p.quantity} u., pedida el ${day} (${p.statusText}). Solo ${p.requesterName} puede pedir más de este producto mientras esa compra siga abierta. Si hace falta más, habla con esa persona.`;
}

// Confirmado 2026-08-11: pedido explícito del usuario — cada comprobante de
// pago (mercadería o flete) debe pertenecer a UNA sola solicitud. Antes de
// dar por pagado, se busca si ese mismo N° de comprobante ya quedó guardado
// en CUALQUIER otra solicitud (mercadería o flete, cualquier estado) — si
// aparece, se bloquea para que no se reutilice por error. receiptNumber
// vacío/no legible nunca bloquea (no hay nada que comparar).
export async function findDuplicatePaymentProofUse(
  receiptNumber: string | null | undefined,
  excludeGroupId: string
): Promise<{ requestNumber: number | null; groupId: string } | null> {
  const trimmed = receiptNumber?.trim();
  if (!trimmed) return null;
  return prisma.purchaseRequest.findFirst({
    where: {
      groupId: { not: excludeGroupId },
      OR: [
        { paymentProofReceiptNumber: trimmed },
        { shippingPaymentProofReceiptNumber: trimmed },
        { paymentProofExtraReceiptNumbers: { has: trimmed } },
        { shippingPaymentProofExtraReceiptNumbers: { has: trimmed } },
      ],
    },
    select: { requestNumber: true, groupId: true },
  });
}

export const extraPaymentProofsSchema = z
  .array(z.object({ url: z.string().url(), receiptNumber: z.string().trim().nullable().optional() }))
  .max(4)
  .optional();

// Confirmado 2026-10-06: varios comprobantes para un mismo pago (ver
// PaymentProofList). Revisa que ninguno se haya usado en otra solicitud y
// que no venga la misma transferencia dos veces para inflar la suma.
export async function checkPaymentProofSet(
  receiptNumbers: (string | null | undefined)[],
  excludeGroupId: string
): Promise<string | null> {
  const numbers = receiptNumbers.map((n) => n?.trim()).filter((n): n is string => !!n);
  if (new Set(numbers).size !== numbers.length) {
    return "Subiste dos veces la misma transferencia — cada comprobante debe ser una transferencia distinta.";
  }
  for (const n of numbers) {
    const dup = await findDuplicatePaymentProofUse(n, excludeGroupId);
    if (dup) {
      return `Ese comprobante ya se usó en otra solicitud (${dup.requestNumber ? formatPurchaseRequestCode(dup.requestNumber) : "otra operación"}) — no se puede reutilizar.`;
    }
  }
  return null;
}

// Confirmado 2026-07-30: el costo por unidad que se compara contra el
// historial ya incluye el envío cuando el proveedor lo cobra aparte — así
// nunca se puede esconder un sobreprecio repartiéndolo entre "producto" y
// "flete" por separado.
export function effectiveUnitCost(req: { unitCost: number; quantity: number; shippingIncluded: boolean; shippingCostTotal: number | null }) {
  if (req.shippingIncluded || !req.shippingCostTotal || req.quantity === 0) return req.unitCost;
  return req.unitCost + req.shippingCostTotal / req.quantity;
}

export type PriceHistoryStats = {
  count: number;
  min: number | null;
  avg: number | null;
  max: number | null;
  last3Avg: number | null;
};

export async function getCatalogItemPriceStats(catalogItemId: string): Promise<PriceHistoryStats> {
  const rows = await prisma.purchaseRequest.findMany({
    where: { catalogItemId, status: { in: PRICED_STATUSES } },
    select: { unitCost: true, quantity: true, shippingIncluded: true, shippingCostTotal: true, requestedAt: true },
    orderBy: { requestedAt: "desc" },
  });
  if (rows.length === 0) return { count: 0, min: null, avg: null, max: null, last3Avg: null };

  const costs = rows.map(effectiveUnitCost);
  const last3 = costs.slice(0, 3);
  return {
    count: rows.length,
    min: Math.min(...costs),
    max: Math.max(...costs),
    avg: costs.reduce((a, b) => a + b, 0) / costs.length,
    last3Avg: last3.reduce((a, b) => a + b, 0) / last3.length,
  };
}

// Confirmado 2026-08-17: "date" sigue siendo la fecha de solicitud (define el
// orden), pero paidAt es la fecha real de pago cuando ya existe — el gráfico
// de tendencia la usa para el eje cuando está disponible, porque eso es lo
// que de verdad le importa a quien aprueba (cuándo se pagó ese precio), no
// cuándo se pidió.
// supplierName/baseUnitCost/shippingPerUnit (confirmado 2026-09-07, pedido
// explícito del usuario) sostienen el desglose de precio en la vista
// combinada "todos los proveedores" (PurchaseInvoicingPanel/PurchaseApprovalInbox)
// — ahí los puntos de distintos proveedores se mezclan en una sola lista y se
// pierde de vista de quién es cada uno si no viaja en el propio punto.
// baseUnitCost es el costo unitario tal cual se negoció (antes de flete);
// shippingPerUnit es 0 cuando el flete ya viene incluido en unitCost o no
// aplica — unitCost sigue siendo el costo efectivo ya usado por el gráfico.
export type SupplierPricePoint = {
  date: string;
  paidAt: string | null;
  unitCost: number;
  quantity: number;
  status: PurchaseRequestStatus;
  supplierName: string;
  baseUnitCost: number;
  shippingPerUnit: number;
  // Confirmado 2026-09-09 (pedido explícito de Jariel): para poder refutar un
  // precio con el proveedor (o cotizarlo con otro) hace falta tener a mano el
  // respaldo real de esa compra — el código de solicitud y la imagen de la
  // cotización (y de la orden de compra, si existía) tal como se subieron
  // entonces, no solo el número.
  id: string;
  requestNumber: number | null;
  quoteImageUrl: string | null;
  purchaseOrderUrl: string | null;
  // Confirmado 2026-09-09 (pedido explícito del usuario, trazabilidad): quién
  // gestionó esa compra — null si la cuenta que la creó ya fue eliminada.
  requestedByName: string | null;
};
export type SupplierPriceHistory = {
  supplierId: string;
  supplierName: string;
  latest: number;
  min: number;
  max: number;
  avg: number;
  count: number;
  history: SupplierPricePoint[];
  // Compra más reciente con este proveedor — mismo dato de arriba, pero a
  // mano sin tener que buscar el último punto del historial.
  latestRequestId: string;
  latestRequestNumber: number | null;
  latestQuoteImageUrl: string | null;
  latestPurchaseOrderUrl: string | null;
  latestRequestedByName: string | null;
  // Confirmado 2026-09-17, pedido explícito del usuario: si a este proveedor
  // no se le compra hace más de un año, su precio ya no es realista para
  // decidir "a quién le compro" hoy — se usa para no marcarlo como "más
  // barato" con un precio desactualizado.
  latestDate: string;
  recentWithinYear: boolean;
};

// Confirmado 2026-07-31: para un mismo insumo, cada proveedor tiene su propia
// serie de precios en el tiempo — se agrupa por proveedor (no se mezcla el
// historial general de effectiveUnitCost, que es global al insumo) y se
// ordena del más barato al más caro (por el precio más reciente pagado) para
// decidir a quién comprarle de un vistazo. Reutilizado tanto por la pantalla
// "Comparar precios" como, desde 2026-08-06, por el formulario de solicitud
// (para sugerir el proveedor más barato) y por la validación server-side que
// exige justificar si se elige uno que no lo es.
export async function getCatalogItemSupplierComparison(catalogItemId: string): Promise<SupplierPriceHistory[]> {
  const rows = await prisma.purchaseRequest.findMany({
    where: { catalogItemId, status: { in: PRICED_STATUSES } },
    select: {
      id: true,
      requestNumber: true,
      quoteImageUrl: true,
      purchaseOrderUrl: true,
      unitCost: true,
      quantity: true,
      shippingIncluded: true,
      shippingCostTotal: true,
      requestedAt: true,
      paidAt: true,
      status: true,
      supplier: { select: { id: true, name: true } },
      requestedBy: { select: { name: true } },
    },
    orderBy: { requestedAt: "asc" },
  });

  const bySupplier = new Map<string, { supplierId: string; supplierName: string; history: SupplierPricePoint[] }>();
  for (const r of rows) {
    const key = r.supplier.id;
    if (!bySupplier.has(key)) bySupplier.set(key, { supplierId: r.supplier.id, supplierName: r.supplier.name, history: [] });
    bySupplier.get(key)!.history.push({
      date: r.requestedAt.toISOString(),
      paidAt: r.paidAt ? r.paidAt.toISOString() : null,
      unitCost: effectiveUnitCost({ unitCost: r.unitCost, quantity: r.quantity, shippingIncluded: r.shippingIncluded, shippingCostTotal: r.shippingCostTotal }),
      quantity: r.quantity,
      status: r.status,
      supplierName: r.supplier.name,
      baseUnitCost: r.unitCost,
      shippingPerUnit: r.shippingIncluded || !r.shippingCostTotal || r.quantity === 0 ? 0 : r.shippingCostTotal / r.quantity,
      id: r.id,
      requestNumber: r.requestNumber,
      quoteImageUrl: r.quoteImageUrl,
      purchaseOrderUrl: r.purchaseOrderUrl,
      requestedByName: r.requestedBy?.name ?? null,
    });
  }
  // Reordenar por fecha efectiva (pago si ya existe, si no la solicitud) —
  // casi siempre coincide con el orden de solicitud, pero no es garantía.
  for (const s of bySupplier.values()) {
    s.history.sort((a, b) => new Date(a.paidAt ?? a.date).getTime() - new Date(b.paidAt ?? b.date).getTime());
  }

  const ONE_YEAR_MS = 365 * 24 * 60 * 60 * 1000;
  const now = Date.now();
  const suppliers: SupplierPriceHistory[] = [...bySupplier.values()].map((s) => {
    const costs = s.history.map((h) => h.unitCost);
    const latestPoint = s.history[s.history.length - 1];
    const latestDate = latestPoint.paidAt ?? latestPoint.date;
    return {
      ...s,
      latest: costs[costs.length - 1],
      min: Math.min(...costs),
      max: Math.max(...costs),
      avg: costs.reduce((a, b) => a + b, 0) / costs.length,
      count: costs.length,
      latestRequestId: latestPoint.id,
      latestRequestNumber: latestPoint.requestNumber,
      latestQuoteImageUrl: latestPoint.quoteImageUrl,
      latestPurchaseOrderUrl: latestPoint.purchaseOrderUrl,
      latestRequestedByName: latestPoint.requestedByName,
      latestDate,
      recentWithinYear: now - new Date(latestDate).getTime() <= ONE_YEAR_MS,
    };
  });
  // Confirmado 2026-09-17, pedido explícito del usuario: proveedores con
  // compra dentro del último año van primero (ordenados del más barato al
  // más caro entre ellos); los que no se les compra hace más de un año caen
  // al final — su precio quedó viejo y ya no es información confiable para
  // decidir a quién comprarle hoy, así que no compiten por el puesto de
  // "más barato" aunque su último precio haya sido bajo.
  suppliers.sort((a, b) => {
    if (a.recentWithinYear !== b.recentWithinYear) return a.recentWithinYear ? -1 : 1;
    return a.latest - b.latest;
  });
  return suppliers;
}

// Historial de costo de envío por unidad para un transportista — mismo
// principio que el del producto, pero aparte, para detectar sobreprecio de
// flete específicamente (ej. cobrar de más por traer poca cantidad).
export async function getCarrierShippingStats(carrierId: string) {
  const rows = await prisma.purchaseRequest.findMany({
    where: { carrierId, shippingIncluded: false, shippingCostTotal: { not: null }, status: { in: PRICED_STATUSES } },
    select: { shippingCostTotal: true, quantity: true, requestedAt: true },
    orderBy: { requestedAt: "asc" },
  });
  return rows
    .filter((r) => r.quantity > 0 && r.shippingCostTotal !== null)
    .map((r) => ({ requestedAt: r.requestedAt.toISOString(), perUnit: r.shippingCostTotal! / r.quantity }));
}

export type StalePurchaseRequestPush = { ownerId: string; title: string; body: string; url: string };

// Confirmado 2026-07-30: si una solicitud lleva más de 24 horas sin avanzar
// a la siguiente etapa, se avisa a quien le corresponde esa etapa — corre
// dentro del mismo cron diario de "Pendientes" (no hay infraestructura para
// algo más frecuente en el plan actual de Vercel), y se vuelve a avisar
// cada día que sigue sin resolverse, mismo espíritu que el resto de esa
// notificación diaria.
export async function getStalePurchaseRequestPushes(): Promise<StalePurchaseRequestPush[]> {
  const cutoff = new Date(Date.now() - 24 * 60 * 60 * 1000);
  const pushes: StalePurchaseRequestPush[] = [];

  const [pendingApproval, approvedUnpaid, paidUnreceived, shippingPaidUnreceived, invLeader, finLeader] = await Promise.all([
    prisma.purchaseRequest.findMany({
      where: { status: "PENDING_APPROVAL", requestedAt: { lt: cutoff } },
      select: { id: true, totalCost: true, catalogItem: { select: { name: true } } },
    }),
    // Corregido 2026-09-15 — bug real y automatizado: sin excluir crédito,
    // este cron le mandaba a diario al admin y a Finanzas "falta pagar" por
    // cada compra de CHEN que llevara más de 24h en APPROVED, aunque un
    // proveedor de crédito nunca se paga por solicitud individual (se paga
    // después, agrupado en una tanda). Mismo criterio que ya usan
    // PurchaseInvoicingPanel.tsx y getPurchaseMerchandisePaymentsSummary.
    prisma.purchaseRequest.findMany({
      where: { status: "APPROVED", reviewedAt: { lt: cutoff }, supplier: { paymentMode: { not: "CREDITO" } } },
      select: { id: true, totalCost: true, catalogItem: { select: { name: true } } },
    }),
    // Fix confirmado 2026-08-24 (reportado por Daniel): esto solo miraba
    // status "PAID" (nadie del equipo subió fotos/video todavía). En cuanto
    // alguien de Inventario las sube, el status pasa a
    // RECEIVED_PENDING_REVIEW esperando la aprobación final de Daniel — pero
    // como ese status no estaba incluido acá, el aviso se apagaba justo
    // cuando a Daniel le tocaba actuar. Ahora también cubre ese estado,
    // usando receipt.confirmedAt (cuándo se subió la recepción) como
    // referencia de "24h sin avanzar" en vez de paidAt.
    prisma.purchaseRequest.findMany({
      where: {
        OR: [
          { status: "PAID", paidAt: { lt: cutoff } },
          { status: "RECEIVED_PENDING_REVIEW", receipt: { confirmedAt: { lt: cutoff } } },
        ],
      },
      select: { id: true, totalCost: true, catalogItem: { select: { name: true } } },
    }),
    // Confirmado 2026-08-14: pedido explícito del usuario — desde que el
    // flete se puede pagar sin esperar a que Inventario confirme recepción,
    // si pasan 24h desde que se pagó el flete (shippingPaidAt) y la
    // mercadería SIGUE sin quedar en RECEIVED, se re-avisa cada día como
    // urgente hasta que se revise — mismo espíritu "se sigue avisando cada
    // día" que el resto de esta función, independiente de paidUnreceived
    // (que mira el pago del producto, no del flete).
    prisma.purchaseRequest.findMany({
      where: { shippingPaidAt: { lt: cutoff }, status: { notIn: ["RECEIVED", "REJECTED"] } },
      select: { id: true, totalCost: true, catalogItem: { select: { name: true } } },
    }),
    prisma.user.findFirst({ where: { isLeader: true, leadsDept: { code: "INV" } }, select: { id: true } }),
    prisma.user.findFirst({ where: { isLeader: true, leadsDept: { code: "FIN" } }, select: { id: true } }),
  ]);

  for (const r of pendingApproval) {
    pushes.push({
      ownerId: "admin",
      title: "⏰ Solicitud sin aprobar hace más de 24h",
      body: `${r.catalogItem.name} — $${r.totalCost.toFixed(2)}`,
      url: "/admin",
    });
  }
  for (const r of approvedUnpaid) {
    const body = `${r.catalogItem.name} — $${r.totalCost.toFixed(2)} aprobado hace más de 24h, todavía sin pagar`;
    pushes.push({ ownerId: "admin", title: "⏰ Falta pagar una compra aprobada", body, url: "/admin" });
    if (finLeader) pushes.push({ ownerId: finLeader.id, title: "⏰ Falta pagar una compra aprobada", body, url: "/area/workspace" });
  }
  for (const r of paidUnreceived) {
    const body = `${r.catalogItem.name} — pagado hace más de 24h, todavía sin quedar con la recepción aprobada`;
    pushes.push({ ownerId: "admin", title: "⏰ Falta confirmar que llegó una compra", body, url: "/admin" });
    if (invLeader) pushes.push({ ownerId: invLeader.id, title: "⏰ Falta confirmar que llegó una compra", body, url: "/area/workspace" });
  }
  for (const r of shippingPaidUnreceived) {
    const body = `${r.catalogItem.name} — el flete ya se pagó hace más de 24h y todavía no se revisa la mercadería`;
    pushes.push({ ownerId: "admin", title: "🚨 Urgente — flete pagado sin revisar mercadería", body, url: "/admin" });
    if (invLeader) pushes.push({ ownerId: invLeader.id, title: "🚨 Urgente — flete pagado sin revisar mercadería", body, url: "/area/workspace" });
  }

  for (const r of await getPurchaseLinesLeftBehind()) {
    if (!r.requestedById) continue;
    pushes.push({
      ownerId: r.requestedById,
      title: "📦 Falta mercadería de un pedido — coordina con el proveedor",
      body: `${r.name} (${r.quantity} un.) · ${r.supplierName} — el resto del pedido ya llegó a bodega y esto no.`,
      url: LEFT_BEHIND_HREF,
    });
  }
  for (const r of await getPurchaseLinesOverdue()) {
    if (!r.requestedById) continue;
    pushes.push({
      ownerId: r.requestedById,
      title: `📦 Pedido sin llegar hace ${r.days} días — pregunta al proveedor`,
      body: `${r.name} (${r.quantity} un.) · ${r.supplierName} — todavía no llega a bodega.`,
      url: OVERDUE_ORDERS_HREF,
    });
  }

  return pushes;
}

export type ShortReceiptUnclaimed = { id: string; name: string; supplierName: string; quantity: number; receivedQuantity: number; missing: number; receivedAt: Date | null; requestedById: string | null; requestedByName: string | null };

// Pedido del usuario 2026-10-05 (caso Bolsa De Lavar Zapatos, 12 ago: 270 de
// 300): compras recibidas con menos de lo pedido y sin ningún reporte urgente
// — el faltante nunca se reclamó. Hoy la recepción ya no deja confirmar una
// cantidad distinta sin "Informar urgente", así que esto queda para los
// casos viejos. Desaparece apenas se abre el reclamo (short-receipt-claim).
export async function getShortReceiptsUnclaimed(requestedById?: string): Promise<ShortReceiptUnclaimed[]> {
  const rows = await prisma.purchaseRequest.findMany({
    where: {
      ...(requestedById ? { requestedById } : {}),
      status: { in: ["RECEIVED", "RECEIVED_PENDING_REVIEW"] },
      receipt: { isNot: null },
      urgentReports: { none: {} },
    },
    select: {
      id: true,
      quantity: true,
      requestedById: true,
      requestedBy: { select: { name: true } },
      catalogItem: { select: { name: true } },
      supplier: { select: { name: true } },
      receipt: { select: { receivedQuantity: true, confirmedAt: true } },
    },
  });
  return rows
    .filter((r) => r.receipt && r.receipt.receivedQuantity < r.quantity)
    .map((r) => ({
      id: r.id,
      name: r.catalogItem.name,
      supplierName: r.supplier?.name ?? "proveedor",
      quantity: r.quantity,
      receivedQuantity: r.receipt!.receivedQuantity,
      missing: r.quantity - r.receipt!.receivedQuantity,
      receivedAt: r.receipt!.confirmedAt,
      requestedById: r.requestedById,
      requestedByName: r.requestedBy?.name ?? null,
    }));
}

const OVERDUE_DAYS = 2; // Pedido del usuario 2026-10-05: 2 días para CHEN y contado (9 de cada 10 pedidos llegan antes).

// Pedido del usuario 2026-10-05: pedido completo (ninguna línea recibida) que
// lleva más de 2 días pagado — o aprobado, si el proveedor es de crédito
// (CHEN no pasa por pago) — sin llegar a bodega ni tener reporte urgente.
// Va a quien compró. Lo que no llegó con el resto del pedido lo cubre
// getPurchaseLinesLeftBehind.
export async function getPurchaseLinesOverdue(requestedById?: string): Promise<(PurchaseLineLeftBehind & { days: number })[]> {
  const cutoff = new Date(Date.now() - OVERDUE_DAYS * 24 * 60 * 60 * 1000);
  const rows = await prisma.purchaseRequest.findMany({
    where: {
      ...(requestedById ? { requestedById } : {}),
      receipt: null,
      urgentReports: { none: {} },
      OR: [
        { status: "PAID", paidAt: { lt: cutoff } },
        { status: "APPROVED", supplier: { paymentMode: "CREDITO" }, reviewedAt: { lt: cutoff } },
      ],
    },
    select: { id: true, groupId: true, quantity: true, requestedById: true, requestedBy: { select: { name: true } }, paidAt: true, reviewedAt: true, catalogItem: { select: { name: true } }, supplier: { select: { name: true } } },
  });
  if (rows.length === 0) return [];
  const groupsWithReceipt = new Set(
    (await prisma.purchaseRequest.findMany({
      where: { groupId: { in: [...new Set(rows.map((r) => r.groupId))] }, receipt: { isNot: null } },
      select: { groupId: true },
    })).map((r) => r.groupId)
  );
  return rows
    .filter((r) => !groupsWithReceipt.has(r.groupId))
    .map((r) => {
      const since = (r.paidAt ?? r.reviewedAt)!;
      return {
        id: r.id,
        groupId: r.groupId,
        name: r.catalogItem.name,
        quantity: r.quantity,
        supplierName: r.supplier?.name ?? "proveedor",
        requestedById: r.requestedById,
        requestedByName: r.requestedBy?.name ?? null,
        since,
        days: Math.floor((Date.now() - since.getTime()) / (24 * 60 * 60 * 1000)),
      };
    });
}

export const OVERDUE_ORDERS_HREF = "/area/workspace?tab=compras&ptab=mias";
// Pedido de Jariel 2026-10-05: lo que no llegó con el resto se coordina desde
// Reportes urgentes (crédito a favor, devolución del dinero o que lo envíen).
export const LEFT_BEHIND_HREF = "/area/workspace?tab=compras&ptab=urgentes";
// Pedido del usuario 2026-10-05: Inventario tiene hasta 24 h para registrar
// lo que falta (llega en otro bulto, se cuenta después); si no, recién ahí
// pasa a Jariel para que lo gestione con el proveedor.
const LEFT_BEHIND_GRACE_MS = 24 * 60 * 60 * 1000;

export type PurchaseLineLeftBehind = { id: string; groupId: string; name: string; quantity: number; supplierName: string; requestedById: string | null; requestedByName: string | null; since: Date };

// Pedido del usuario 2026-10-05 (caso candado de Zheng wu, 2 oct): Inventario
// recibió parte del pedido y el producto que no vino quedó "Pagada" sin
// recepción ni reporte urgente — nadie le avisó a Jariel. Esto lo detecta
// solo: líneas sin recepción (pagadas, o aprobadas si el proveedor es de
// crédito) cuyo mismo pedido (groupId) ya tiene otra línea recibida hace más
// de 24 h. Sale de la lista apenas Inventario la recibe o la reporta.
export async function getPurchaseLinesLeftBehind(requestedById?: string, graceMs: number = LEFT_BEHIND_GRACE_MS): Promise<PurchaseLineLeftBehind[]> {
  const waiting = await prisma.purchaseRequest.findMany({
    where: {
      ...(requestedById ? { requestedById } : {}),
      receipt: null,
      urgentReports: { none: {} },
      OR: [{ status: "PAID" }, { status: "APPROVED", supplier: { paymentMode: "CREDITO" } }],
    },
    select: { id: true, groupId: true, quantity: true, requestedById: true, requestedBy: { select: { name: true } }, catalogItem: { select: { name: true } }, supplier: { select: { name: true } } },
  });
  if (waiting.length === 0) return [];

  const cutoff = new Date(Date.now() - graceMs);
  const received = await prisma.purchaseRequestReceipt.findMany({
    where: { request: { groupId: { in: [...new Set(waiting.map((w) => w.groupId))] } }, confirmedAt: { lt: cutoff } },
    select: { confirmedAt: true, request: { select: { groupId: true } } },
  });
  const firstReceived = new Map<string, Date>();
  for (const r of received) {
    if (!r.confirmedAt) continue;
    const cur = firstReceived.get(r.request.groupId);
    if (!cur || r.confirmedAt < cur) firstReceived.set(r.request.groupId, r.confirmedAt);
  }
  return waiting
    .filter((w) => firstReceived.has(w.groupId))
    .map((w) => ({
      id: w.id,
      groupId: w.groupId,
      name: w.catalogItem.name,
      quantity: w.quantity,
      supplierName: w.supplier?.name ?? "proveedor",
      requestedById: w.requestedById,
      requestedByName: w.requestedBy?.name ?? null,
      since: firstReceived.get(w.groupId)!,
    }));
}

// Confirmado 2026-07-31: una cotización suele traer varios productos — se
// manda un arreglo `items`, todos comparten proveedor/cotización/envío.
export const purchaseLineSchema = z.object({
  catalogItemId: z.string().min(1),
  // Ver needsFulfillmentSize — solo se manda si el producto no estaba marcado.
  fulfillmentSize: z.enum(["SMALL", "NORMAL"]).nullable().optional(),
  quantity: z.number().int().positive(),
  unitCost: z.number().positive(),
  // Confirmado 2026-09-07 (bug real reportado por el usuario) — antes había
  // una sola justificación por SOLICITUD completa, y esa misma frase se
  // guardaba en todos los productos del grupo aunque solo uno hubiera
  // superado el historial. Un revisor de otro producto en la misma cotización
  // terminaba con una nota que no le correspondía (ej. "precio normal $2.25 a
  // $2.75" pegada en un producto que cuesta $11.50). Ahora cada línea trae su
  // propia justificación — impuesta en checkPurchaseSubmission solo para las
  // líneas que de verdad la necesitan (superó el historial o el proveedor
  // elegido no es el más barato para ESE producto).
  justification: z.string().trim().nullable().optional(),
  // Confirmado 2026-09-21, pedido explícito del usuario (ya no se usará
  // Just): cuando la cotización solo trae un código de proveedor para ESTA
  // línea (sin nombre de producto), viene el código que la IA detectó — el
  // servidor exige que ese código YA esté guardado en el producto elegido
  // (PurchaseCatalogItem.code), es decir que Jariel ya lo haya confirmado a
  // mano con el doble clic antes de poder enviar (ver /confirm-code). Nunca
  // se confía en que el cliente diga "ya confirmé" sin verificarlo contra la
  // base de datos.
  quoteReferenceCode: z.string().trim().nullable().optional(),
});

// Confirmado 2026-08-08: compartido entre crear una solicitud nueva
// (POST /api/purchase-requests) y corregir una rechazada en su lugar
// (POST /api/purchase-requests/group/[groupId]/resubmit) — ambos flujos
// deben validar EXACTAMENTE lo mismo (cuenta bancaria obligatoria, cotización
// vs. lo escrito, umbral de precio, proveedor más barato), así que la lógica
// vive en un solo lugar en vez de duplicarse y arriesgar que diverjan.
export const purchaseSubmissionSchema = z.object({
  items: z.array(purchaseLineSchema).min(1, "Agrega al menos un producto."),
  supplierId: z.string().min(1),
  bankAccountId: z.string().min(1).nullable().optional(),
  // Confirmado 2026-09-14: solo obligatoria para proveedores que NO son de
  // crédito — impuesto en checkPurchaseSubmission (necesita el paymentMode
  // real del proveedor, no se puede validar acá con el shape solo).
  quoteImageUrl: z.string().url().nullable().optional(),
  quoteReadTotal: z.number().nullable(),
  shippingIncluded: z.boolean(),
  // Confirmado 2026-08-11: a veces todavía no se sabe transportista ni costo
  // real del flete al solicitar — con esto en true, ninguno de los dos es
  // obligatorio (se completan después desde "Mis solicitudes").
  shippingCarrierPending: z.boolean().optional(),
  carrierId: z.string().min(1).nullable().optional(),
  shippingCostTotal: z.number().nonnegative().nullable().optional(),
  shippingPaymentMethod: z.enum(["TRANSFER", "PETTY_CASH"]).nullable().optional(),
  shippingPaymentTiming: z.enum(["WITH_PURCHASE", "ON_DELIVERY"]).nullable().optional(),
  carrierBankAccountId: z.string().min(1).nullable().optional(),
  // Confirmado 2026-08-12: créditos con el proveedor elegido, marcados para
  // usarse en esta misma solicitud — se reservan al enviar (ver
  // reserveCreditsForGroup en supplierCredits.ts), nunca pueden superar el
  // total de la solicitud.
  appliedCreditIds: z.array(z.string()).optional(),
  // Confirmado 2026-09-03: pedido explícito del usuario — obligatoria solo
  // cuando el proveedor tiene crédito disponible y no se aplicó nada de eso
  // en appliedCreditIds — impuesta en checkPurchaseSubmission, no aquí.
  creditSkipJustification: z.string().trim().nullable().optional(),
  // Confirmado 2026-09-03: solo se respeta cuando quien envía tiene el
  // permiso de emergencia (ver canSubmitEmergencyPurchaseRequest en
  // guards.ts) — la ruta ignora este campo para cualquier otra persona, así
  // que no sirve para saltarse la aprobación normal.
  isEmergency: z.boolean().optional(),
  emergencyReason: z.string().trim().nullable().optional(),
  // Confirmado 2026-09-09 (Fase 2, Análisis de Mercado): opcional, solo
  // trazabilidad — se guarda de dónde vino cuando Jariel ejecuta acá una
  // propuesta que Bryan ya marcó lista para comprar. Nunca obligatorio ni
  // valida nada distinto — una solicitud normal simplemente no lo trae.
  marketProductProposalId: z.string().nullable().optional(),
  // Pedido de Jariel 2026-10-07: "Sí, ya lo hice" al final de Solicitar —
  // recompra caliente con el análisis de competencia hecho por quien compra
  // (ver checkRepurchaseApprovals). Solo sirve para compras calientes.
  hotRepurchaseDeclared: z.boolean().optional(),
});

export type PurchaseSubmissionData = z.infer<typeof purchaseSubmissionSchema>;

export type PurchaseSubmissionCheck =
  | {
      ok: true;
      resolvedBankAccountId: string | null;
      anyOverThreshold: boolean;
      anySupplierNotCheapest: boolean;
      creditSkipJustification: string | null;
      nameById: Map<string, string>;
      groupTotal: number;
      // Indexado por posición en d.items, NUNCA por catalogItemId — el mismo
      // producto puede aparecer en dos líneas distintas de una misma
      // solicitud (ej. dos cotizaciones de precio diferente), y un Map por
      // id perdería el flete de una de las dos.
      lineShippingByIndex: (number | null)[];
      // Confirmado 2026-09-07 (fix del bug de justificación copiada entre
      // productos) — la justificación final por línea, ya resuelta: el texto
      // que esa línea escribió si de verdad lo necesitaba, o null si no le
      // aplicaba. La ruta usa esto directo al crear cada fila, en vez de
      // reusar un solo texto compartido para todo el grupo.
      justificationByIndex: (string | null)[];
    }
  | { ok: false; error: string; status: number };

// Confirmado 2026-09-23, revisión anti-fraude pedida por el usuario: el
// transportista tiene que ser un transportista registrado, o el MISMO
// proveedor de la compra ("el flete lo cobra el mismo proveedor" — antes no
// existía esa opción y había que inventar un transportista con la cuenta del
// proveedor, caso "Ting (NO)" en SC-067). La cuenta del flete tiene que ser
// de ese transportista/proveedor.
export async function checkCarrierChoice(p: { supplierId: string; carrierId: string; carrierBankAccountId: string | null }): Promise<string | null> {
  if (p.carrierId !== p.supplierId) {
    const carrier = await prisma.supplier.findUnique({ where: { id: p.carrierId }, select: { type: true } });
    if (!carrier || carrier.type !== "CARRIER") return "El transportista elegido no es válido.";
  }
  if (p.carrierBankAccountId) {
    const account = await prisma.supplierBankAccount.findUnique({ where: { id: p.carrierBankAccountId }, select: { supplierId: true } });
    if (!account || account.supplierId !== p.carrierId) return "La cuenta del flete no es de ese transportista.";
  }
  return null;
}

export async function checkPurchaseSubmission(d: PurchaseSubmissionData): Promise<PurchaseSubmissionCheck> {
  if (!d.shippingIncluded && !d.carrierId && !d.shippingCarrierPending) {
    return { ok: false, status: 400, error: "Falta el transportista, ya que el envío no está incluido." };
  }
  if (!d.shippingIncluded && !d.shippingCarrierPending && d.carrierId) {
    const carrierError = await checkCarrierChoice({ supplierId: d.supplierId, carrierId: d.carrierId, carrierBankAccountId: d.carrierBankAccountId ?? null });
    if (carrierError) return { ok: false, status: 400, error: carrierError };
  }

  // Confirmado 2026-09-14, pedido explícito de Jariel/del usuario: un
  // proveedor de crédito (hoy CHEN) se solicita directo con esta
  // herramienta — ni cotización, ni orden de compra, ni cuenta bancaria
  // matriculada de antemano (el usuario conversa directo con CHEN y paga a
  // la cuenta que él le mande al momento del pago real, por tanda — ver
  // SupplierDebtTransfer). Nada de esto aplica a proveedores de pago
  // anticipado, que siguen exactamente igual que antes.
  const supplier = await prisma.supplier.findUnique({ where: { id: d.supplierId }, select: { paymentMode: true } });
  const isCreditoSupplier = supplier?.paymentMode === "CREDITO";

  // Confirmado 2026-08-07: bug real — si el proveedor no tenía NINGUNA cuenta
  // registrada, bankAccountId se guardaba en null sin ningún aviso. Ahora es
  // obligatorio elegir una cuenta real del proveedor.
  // Confirmado 2026-08-18: pedido explícito del usuario — nunca se elige la
  // cuenta en automático, ni siquiera cuando el proveedor solo tiene una;
  // quien solicita siempre debe elegirla a propósito en la UI.
  let resolvedBankAccountId: string | null = null;
  if (!isCreditoSupplier) {
    const supplierBankAccounts = await prisma.supplierBankAccount.findMany({ where: { supplierId: d.supplierId }, select: { id: true } });
    if (supplierBankAccounts.length === 0) {
      return { ok: false, status: 400, error: "Este proveedor no tiene ninguna cuenta bancaria registrada — agrégale una cuenta antes de enviar la solicitud." };
    }
    if (!d.bankAccountId) {
      return { ok: false, status: 400, error: "Elige la cuenta bancaria del proveedor a la que se le paga." };
    }
    if (!supplierBankAccounts.some((a) => a.id === d.bankAccountId)) {
      return { ok: false, status: 400, error: "La cuenta bancaria elegida no pertenece a este proveedor." };
    }
    resolvedBankAccountId = d.bankAccountId;
  }

  const groupTotal = d.items.reduce((sum, it) => sum + it.quantity * it.unitCost, 0);

  if (!isCreditoSupplier && !d.quoteImageUrl) {
    return { ok: false, status: 400, error: "Falta la cotización." };
  }

  // Pedido de Nairoby 2026-10-05 (cotización de Compel): cuando el flete lo
  // cobra el mismo proveedor, su cotización/factura suele traer el flete
  // sumado al total ($332.93 + $8.36 = $341.29) — eso también cuenta como que
  // coincide. Solo en ese caso: si el flete lo cobra otro transportista, la
  // cotización del proveedor nunca lo incluye.
  const supplierShipping =
    !d.shippingIncluded && !d.shippingCarrierPending && !!d.carrierId && d.carrierId === d.supplierId ? d.shippingCostTotal ?? 0 : 0;
  const matches =
    d.quoteReadTotal !== null &&
    (Math.abs(d.quoteReadTotal - groupTotal) < 0.01 || (supplierShipping > 0 && Math.abs(d.quoteReadTotal - (groupTotal + supplierShipping)) < 0.01));
  const anyLineManuallyConfirmed = d.items.some((it) => !!it.quoteReferenceCode);
  if (!isCreditoSupplier && !matches && !anyLineManuallyConfirmed) {
    return { ok: false, status: 400, error: "La cotización no coincide con lo escrito — verifícala de nuevo antes de enviar." };
  }
  // Confirmado 2026-09-21, pedido explícito del usuario (ya no se usará
  // Just): cuando una línea trae solo un código de proveedor (sin nombre de
  // producto), en vez de exigir una orden de compra de respaldo, se exige
  // que ese código YA esté guardado contra el producto elegido — es decir,
  // que Jariel ya lo haya confirmado con el doble clic en el formulario
  // (ver /api/purchase-requests/confirm-code). Nunca se confía en un booleano
  // que mande el cliente: se vuelve a consultar el catálogo acá mismo.
  for (const it of d.items) {
    if (!it.quoteReferenceCode) continue;
    const item = await prisma.purchaseCatalogItem.findUnique({ where: { id: it.catalogItemId }, select: { name: true, code: true } });
    if (!item || (item.code ?? "").trim().toLowerCase() !== it.quoteReferenceCode.trim().toLowerCase()) {
      return {
        ok: false,
        status: 400,
        error: `La cotización solo trae un código para "${item?.name ?? "un producto"}", sin nombre — confirma a qué producto corresponde antes de enviar.`,
      };
    }
  }

  const totalQty = d.items.reduce((s, it) => s + it.quantity, 0);
  const lineShippingByIndex: (number | null)[] = [];
  // Confirmado 2026-09-07 (fix del bug de justificación copiada entre
  // productos) — antes solo se guardaba UN booleano global (anyOverThreshold)
  // y un solo texto de justificación para todo el grupo, así que un producto
  // que ni siquiera superó su historial terminaba con la explicación de OTRO
  // producto pegada encima. Ahora needsJustificationByIndex marca, línea por
  // línea, cuál de verdad necesita su propia explicación.
  const needsJustificationByIndex: boolean[] = d.items.map(() => false);
  let anyOverThreshold = false;
  const lineChecks: { idx: number; catalogItemName: string; effCost: number; last3Avg: number }[] = [];
  for (let i = 0; i < d.items.length; i++) {
    const it = d.items[i];
    const stats = await getCatalogItemPriceStats(it.catalogItemId);
    const lineShipping = d.shippingIncluded || !d.shippingCostTotal ? null : (d.shippingCostTotal * it.quantity) / totalQty;
    lineShippingByIndex.push(lineShipping);
    const effCost = effectiveUnitCost({ unitCost: it.unitCost, quantity: it.quantity, shippingIncluded: d.shippingIncluded, shippingCostTotal: lineShipping });
    if (stats.last3Avg !== null && effCost > stats.last3Avg) {
      anyOverThreshold = true;
      needsJustificationByIndex[i] = true;
      const item = await prisma.purchaseCatalogItem.findUnique({ where: { id: it.catalogItemId }, select: { name: true } });
      lineChecks.push({ idx: i, catalogItemName: item?.name ?? "?", effCost, last3Avg: stats.last3Avg });
    }
  }
  // Confirmado 2026-08-06: además de superar el historial de precio, si el
  // proveedor elegido no es el más barato conocido, también hace falta
  // justificar — mismo campo `justification` de esa línea, ambos motivos se
  // combinan si aplican al mismo producto.
  let anySupplierNotCheapest = false;
  const supplierChecks: { idx: number; catalogItemName: string; cheapestSupplierName: string; cheapestPrice: number }[] = [];
  for (let i = 0; i < d.items.length; i++) {
    const it = d.items[i];
    const comparison = await getCatalogItemSupplierComparison(it.catalogItemId);
    if (comparison.length === 0) continue;
    const cheapest = comparison[0];
    // Confirmado 2026-09-17: si ni siquiera el más barato de la lista tiene
    // una compra del último año, ningún precio conocido es confiable —
    // no tiene sentido exigir justificar por no comprarle a un precio
    // desactualizado.
    if (!cheapest.recentWithinYear) continue;
    // Confirmado 2026-10-01: si el precio de hoy ya iguala o mejora al más
    // barato conocido, no hay nada que justificar.
    const lineShipping = lineShippingByIndex[i];
    const effCost = effectiveUnitCost({ unitCost: it.unitCost, quantity: it.quantity, shippingIncluded: d.shippingIncluded, shippingCostTotal: lineShipping });
    if (cheapest.supplierId !== d.supplierId && effCost > cheapest.latest) {
      anySupplierNotCheapest = true;
      needsJustificationByIndex[i] = true;
      const item = await prisma.purchaseCatalogItem.findUnique({ where: { id: it.catalogItemId }, select: { name: true } });
      supplierChecks.push({ idx: i, catalogItemName: item?.name ?? "?", cheapestSupplierName: cheapest.supplierName, cheapestPrice: cheapest.latest });
    }
  }

  const missingJustificationIdx = needsJustificationByIndex
    .map((needs, i) => (needs && !d.items[i].justification?.trim() ? i : null))
    .filter((i): i is number => i !== null);
  if (missingJustificationIdx.length > 0) {
    const parts: string[] = [];
    const overForMissing = lineChecks.filter((l) => missingJustificationIdx.includes(l.idx));
    const supplierForMissing = supplierChecks.filter((s) => missingJustificationIdx.includes(s.idx));
    if (overForMissing.length > 0) {
      const detail = overForMissing.map((l) => `${l.catalogItemName} ($${l.effCost.toFixed(2)} vs. $${l.last3Avg.toFixed(2)})`).join(", ");
      parts.push(`Falta justificar el precio de: ${detail}`);
    }
    if (supplierForMissing.length > 0) {
      const detail = supplierForMissing.map((s) => `${s.catalogItemName} — ${s.cheapestSupplierName} lo vendió más barato ($${s.cheapestPrice.toFixed(2)})`).join(", ");
      parts.push(`Falta justificar el proveedor elegido para: ${detail}`);
    }
    return { ok: false, status: 400, error: `${parts.join(" · ")} — cada producto necesita su propia justificación.` };
  }
  const justificationByIndex = needsJustificationByIndex.map((needs, i) => (needs ? d.items[i].justification!.trim() : null));

  // Confirmado 2026-09-03: pedido explícito del usuario — si el proveedor
  // tiene crédito disponible y no se aplicó (todo o en parte) a esta
  // solicitud, hace falta una breve justificación, mismo patrón que el
  // umbral de precio arriba. Así Finanzas (quien paga) siempre tiene un
  // respaldo de que el crédito sí se revisó al pedir, en vez de solo
  // enterarse después de que ya se le pasó a quien pidió.
  const availableCredits = await getAvailableCreditsForSupplier(d.supplierId);
  const appliedIds = new Set(d.appliedCreditIds ?? []);
  const skippedCredits = availableCredits.filter((c) => !appliedIds.has(c.id));
  let creditSkipJustification: string | null = null;
  if (skippedCredits.length > 0) {
    if (!d.creditSkipJustification?.trim()) {
      const skippedTotal = skippedCredits.reduce((s, c) => s + c.amount, 0);
      return {
        ok: false,
        status: 400,
        error: `Hay $${skippedTotal.toFixed(2)} de crédito disponible con este proveedor y no lo estás aplicando — agrega una breve justificación o marca el crédito arriba.`,
      };
    }
    creditSkipJustification = d.creditSkipJustification.trim();
  }

  const catalogItems = await prisma.purchaseCatalogItem.findMany({
    where: { id: { in: d.items.map((it) => it.catalogItemId) } },
    select: { id: true, name: true },
  });
  if (catalogItems.length !== new Set(d.items.map((it) => it.catalogItemId)).size) {
    return { ok: false, status: 404, error: "Uno o más productos, mercaderías o insumos no fueron encontrados." };
  }
  const nameById = new Map(catalogItems.map((c) => [c.id, c.name]));

  return { ok: true, resolvedBankAccountId, anyOverThreshold, anySupplierNotCheapest, creditSkipJustification, nameById, groupTotal, lineShippingByIndex, justificationByIndex };
}

const bankAccountSelect = { id: true, supplierId: true, bankName: true, bankAccountType: true, bankAccountNumber: true, bankAccountHolder: true, holderIdType: true, holderIdNumber: true, verifiedAt: true, createdAt: true, createdBy: { select: { name: true } } };

// Include compartido por las rutas de solicitudes de compra (listar,
// aprobar, recibir, facturar, auditar, corregir) — un solo lugar para no
// tener 6 copias ligeramente distintas del mismo shape.
export const purchaseRequestInclude = {
  catalogItem: { select: { id: true, name: true, photos: true, justCode: true, hasExpiration: true, awaitingDropiId: true, warehouseArea: true } },
  supplier: { select: { id: true, name: true, paymentMode: true, givesInvoice: true, givesInvoiceSetBy: true, bankAccounts: { orderBy: { createdAt: "asc" as const } } } },
  carrier: { select: { id: true, name: true, bankAccounts: { orderBy: { createdAt: "asc" as const } } } },
  bankAccount: { select: bankAccountSelect },
  carrierBankAccount: { select: bankAccountSelect },
  bankAccountChangeRequestedBy: { select: { name: true } },
  bankAccountChangedAfterApprovalBy: { select: { name: true } },
  requestedBy: { select: { name: true } },
  reviewedBy: { select: { name: true } },
  paidBy: { select: { name: true } },
  invoicedBy: { select: { name: true } },
  shippingPaymentRequestedBy: { select: { name: true } },
  shippingPaidBy: { select: { name: true } },
  financeFlaggedBy: { select: { name: true } },
  receipt: { include: { confirmedBy: { select: { name: true } }, approvedBy: { select: { name: true } }, quantityCorrectedBy: { select: { name: true } } } },
  urgentReports: {
    orderBy: { reportedAt: "desc" as const },
    include: {
      reportedBy: { select: { name: true } },
      reviewedByLead: { select: { name: true } },
      resolvedInternallyBy: { select: { name: true } },
      // Confirmado 2026-08-12: pedido explícito del usuario — Auditoría
      // necesita saber si un reporte urgente ya quedó resuelto del todo
      // (suma de resoluciones COMPLETED cubre el total reportado) para
      // poder excluir del historial cualquier operación que todavía tenga
      // algo pendiente con el proveedor.
      resolutions: { select: { quantity: true, status: true } },
    },
  },
};

// Confirmado 2026-09-30, pedido del usuario: los productos que nunca pasaron
// por la calculadora de Jariel no saben si son pequeños ($0.50 de
// fulfillment) o normales ($0.75). La primera vez que se vuelven a comprar,
// quien compra lo elige UNA vez (doble confirmación en el formulario) y queda
// guardado en el producto. Después ya no se pregunta; solo el admin lo cambia.
// Pedido del usuario 2026-10-05: los Suministros (cinta, papel…) no se
// despachan, así que no llevan fulfillment — nunca se pregunta por ellos.
export async function getCatalogItemsNeedingFulfillmentSize(catalogItemIds: string[]): Promise<Set<string>> {
  const ids = [...new Set(catalogItemIds)];
  if (ids.length === 0) return new Set();
  const items = await prisma.purchaseCatalogItem.findMany({
    where: { id: { in: ids }, fulfillmentSize: null, OR: [{ bodega: null }, { bodega: { not: "MKT_SUMINISTROS" } }] },
    select: { id: true, marketProductProposal: { select: { id: true } } },
  });
  return new Set(items.filter((i) => !i.marketProductProposal).map((i) => i.id));
}

export async function checkAndSaveFulfillmentSizes(
  items: { catalogItemId: string; fulfillmentSize?: "SMALL" | "NORMAL" | null }[],
  userId: string | null
): Promise<string | null> {
  const needed = await getCatalogItemsNeedingFulfillmentSize(items.map((i) => i.catalogItemId));
  if (needed.size === 0) return null;
  const missing = items.filter((i) => needed.has(i.catalogItemId) && !i.fulfillmentSize);
  if (missing.length > 0) {
    const names = await prisma.purchaseCatalogItem.findMany({ where: { id: { in: missing.map((m) => m.catalogItemId) } }, select: { name: true } });
    return `Marca si es producto pequeño o normal: ${names.map((n) => n.name).join(", ")}.`;
  }
  const now = new Date();
  for (const it of items) {
    if (!needed.has(it.catalogItemId) || !it.fulfillmentSize) continue;
    await prisma.purchaseCatalogItem.updateMany({
      where: { id: it.catalogItemId, fulfillmentSize: null },
      data: { fulfillmentSize: it.fulfillmentSize, fulfillmentSizeSetAt: now, fulfillmentSizeSetById: userId },
    });
  }
  return null;
}
