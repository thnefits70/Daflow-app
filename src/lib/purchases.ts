import { z } from "zod";
import { prisma } from "@/lib/prisma";
import type { PurchaseRequestStatus } from "@/generated/prisma/client";

// Estados que cuentan como "compra real" para el historial de precio — no
// las que todavía están pendientes de aprobar (no son un precio confirmado
// todavía) ni las rechazadas.
const PRICED_STATUSES: PurchaseRequestStatus[] = ["APPROVED", "PAID", "RECEIVED"];

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
      OR: [{ paymentProofReceiptNumber: trimmed }, { shippingPaymentProofReceiptNumber: trimmed }],
    },
    select: { requestNumber: true, groupId: true },
  });
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
export type SupplierPricePoint = { date: string; paidAt: string | null; unitCost: number; quantity: number; status: PurchaseRequestStatus };
export type SupplierPriceHistory = {
  supplierId: string;
  supplierName: string;
  latest: number;
  min: number;
  max: number;
  avg: number;
  count: number;
  history: SupplierPricePoint[];
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
      unitCost: true,
      quantity: true,
      shippingIncluded: true,
      shippingCostTotal: true,
      requestedAt: true,
      paidAt: true,
      status: true,
      supplier: { select: { id: true, name: true } },
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
    });
  }
  // Reordenar por fecha efectiva (pago si ya existe, si no la solicitud) —
  // casi siempre coincide con el orden de solicitud, pero no es garantía.
  for (const s of bySupplier.values()) {
    s.history.sort((a, b) => new Date(a.paidAt ?? a.date).getTime() - new Date(b.paidAt ?? b.date).getTime());
  }

  const suppliers: SupplierPriceHistory[] = [...bySupplier.values()].map((s) => {
    const costs = s.history.map((h) => h.unitCost);
    return {
      ...s,
      latest: costs[costs.length - 1],
      min: Math.min(...costs),
      max: Math.max(...costs),
      avg: costs.reduce((a, b) => a + b, 0) / costs.length,
      count: costs.length,
    };
  });
  suppliers.sort((a, b) => a.latest - b.latest);
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
    prisma.purchaseRequest.findMany({
      where: { status: "APPROVED", reviewedAt: { lt: cutoff } },
      select: { id: true, totalCost: true, catalogItem: { select: { name: true } } },
    }),
    prisma.purchaseRequest.findMany({
      where: { status: "PAID", paidAt: { lt: cutoff } },
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
    const body = `${r.catalogItem.name} — pagado hace más de 24h, Inventario todavía no confirma que llegó`;
    pushes.push({ ownerId: "admin", title: "⏰ Falta confirmar que llegó una compra", body, url: "/admin" });
    if (invLeader) pushes.push({ ownerId: invLeader.id, title: "⏰ Falta confirmar que llegó una compra", body, url: "/area/workspace" });
  }
  for (const r of shippingPaidUnreceived) {
    const body = `${r.catalogItem.name} — el flete ya se pagó hace más de 24h y todavía no se revisa la mercadería`;
    pushes.push({ ownerId: "admin", title: "🚨 Urgente — flete pagado sin revisar mercadería", body, url: "/admin" });
    if (invLeader) pushes.push({ ownerId: invLeader.id, title: "🚨 Urgente — flete pagado sin revisar mercadería", body, url: "/area/workspace" });
  }

  return pushes;
}

// Confirmado 2026-07-31: una cotización suele traer varios productos — se
// manda un arreglo `items`, todos comparten proveedor/cotización/envío.
export const purchaseLineSchema = z.object({
  catalogItemId: z.string().min(1),
  quantity: z.number().int().positive(),
  unitCost: z.number().positive(),
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
  quoteImageUrl: z.string().url(),
  quoteReadTotal: z.number().nullable(),
  quoteReferenceCode: z.string().trim().nullable().optional(),
  purchaseOrderUrl: z.string().url().nullable().optional(),
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
  justification: z.string().trim().nullable().optional(),
  // Confirmado 2026-08-12: créditos con el proveedor elegido, marcados para
  // usarse en esta misma solicitud — se reservan al enviar (ver
  // reserveCreditsForGroup en supplierCredits.ts), nunca pueden superar el
  // total de la solicitud.
  appliedCreditIds: z.array(z.string()).optional(),
});

export type PurchaseSubmissionData = z.infer<typeof purchaseSubmissionSchema>;

export type PurchaseSubmissionCheck =
  | {
      ok: true;
      resolvedBankAccountId: string;
      anyOverThreshold: boolean;
      anySupplierNotCheapest: boolean;
      nameById: Map<string, string>;
      groupTotal: number;
      // Indexado por posición en d.items, NUNCA por catalogItemId — el mismo
      // producto puede aparecer en dos líneas distintas de una misma
      // solicitud (ej. dos cotizaciones de precio diferente), y un Map por
      // id perdería el flete de una de las dos.
      lineShippingByIndex: (number | null)[];
    }
  | { ok: false; error: string; status: number };

export async function checkPurchaseSubmission(d: PurchaseSubmissionData): Promise<PurchaseSubmissionCheck> {
  if (!d.shippingIncluded && !d.carrierId && !d.shippingCarrierPending) {
    return { ok: false, status: 400, error: "Falta el transportista, ya que el envío no está incluido." };
  }

  // Confirmado 2026-08-07: bug real — si el proveedor no tenía NINGUNA cuenta
  // registrada, bankAccountId se guardaba en null sin ningún aviso. Ahora es
  // obligatorio elegir una cuenta real del proveedor.
  // Confirmado 2026-08-18: pedido explícito del usuario — nunca se elige la
  // cuenta en automático, ni siquiera cuando el proveedor solo tiene una;
  // quien solicita siempre debe elegirla a propósito en la UI.
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
  const resolvedBankAccountId = d.bankAccountId;

  const groupTotal = d.items.reduce((sum, it) => sum + it.quantity * it.unitCost, 0);
  const matches = d.quoteReadTotal !== null && Math.abs(d.quoteReadTotal - groupTotal) < 0.01;
  const manuallyConfirmed = !!d.quoteReferenceCode;
  if (!matches && !manuallyConfirmed) {
    return { ok: false, status: 400, error: "La cotización no coincide con lo escrito — verifícala de nuevo antes de enviar." };
  }
  // Confirmado 2026-07-31: cuando la cotización solo trae un código de
  // proveedor (no el nombre del producto), la orden de compra es obligatoria.
  if (manuallyConfirmed && !d.purchaseOrderUrl) {
    return {
      ok: false,
      status: 400,
      error: "La cotización solo trae un código, sin nombre de producto — sube la orden de compra como respaldo antes de enviar.",
    };
  }

  const totalQty = d.items.reduce((s, it) => s + it.quantity, 0);
  const lineShippingByIndex: (number | null)[] = [];
  let anyOverThreshold = false;
  const lineChecks: { catalogItemName: string; effCost: number; last3Avg: number }[] = [];
  for (const it of d.items) {
    const stats = await getCatalogItemPriceStats(it.catalogItemId);
    const lineShipping = d.shippingIncluded || !d.shippingCostTotal ? null : (d.shippingCostTotal * it.quantity) / totalQty;
    lineShippingByIndex.push(lineShipping);
    const effCost = effectiveUnitCost({ unitCost: it.unitCost, quantity: it.quantity, shippingIncluded: d.shippingIncluded, shippingCostTotal: lineShipping });
    if (stats.last3Avg !== null && effCost > stats.last3Avg) {
      anyOverThreshold = true;
      const item = await prisma.purchaseCatalogItem.findUnique({ where: { id: it.catalogItemId }, select: { name: true } });
      lineChecks.push({ catalogItemName: item?.name ?? "?", effCost, last3Avg: stats.last3Avg });
    }
  }
  // Confirmado 2026-08-06: además de superar el historial de precio, si el
  // proveedor elegido no es el más barato conocido, también hace falta
  // justificar — mismo campo `justification`, ambos motivos se combinan.
  let anySupplierNotCheapest = false;
  const supplierChecks: { catalogItemName: string; cheapestSupplierName: string; cheapestPrice: number }[] = [];
  for (const it of d.items) {
    const comparison = await getCatalogItemSupplierComparison(it.catalogItemId);
    if (comparison.length === 0) continue;
    const cheapest = comparison[0];
    if (cheapest.supplierId !== d.supplierId) {
      anySupplierNotCheapest = true;
      const item = await prisma.purchaseCatalogItem.findUnique({ where: { id: it.catalogItemId }, select: { name: true } });
      supplierChecks.push({ catalogItemName: item?.name ?? "?", cheapestSupplierName: cheapest.supplierName, cheapestPrice: cheapest.latest });
    }
  }

  if ((anyOverThreshold || anySupplierNotCheapest) && !d.justification?.trim()) {
    const parts: string[] = [];
    if (lineChecks.length > 0) {
      const detail = lineChecks.map((l) => `${l.catalogItemName} ($${l.effCost.toFixed(2)} vs. $${l.last3Avg.toFixed(2)})`).join(", ");
      parts.push(`Uno o más productos superan el promedio de las últimas compras (${detail})`);
    }
    if (supplierChecks.length > 0) {
      const detail = supplierChecks.map((s) => `${s.catalogItemName} — ${s.cheapestSupplierName} lo vendió más barato ($${s.cheapestPrice.toFixed(2)})`).join(", ");
      parts.push(`Hay un proveedor más barato para uno o más productos (${detail})`);
    }
    return { ok: false, status: 400, error: `${parts.join(" · ")} — agrega una justificación.` };
  }

  const catalogItems = await prisma.purchaseCatalogItem.findMany({
    where: { id: { in: d.items.map((it) => it.catalogItemId) } },
    select: { id: true, name: true },
  });
  if (catalogItems.length !== new Set(d.items.map((it) => it.catalogItemId)).size) {
    return { ok: false, status: 404, error: "Uno o más productos, mercaderías o insumos no fueron encontrados." };
  }
  const nameById = new Map(catalogItems.map((c) => [c.id, c.name]));

  return { ok: true, resolvedBankAccountId, anyOverThreshold, anySupplierNotCheapest, nameById, groupTotal, lineShippingByIndex };
}

const bankAccountSelect = { id: true, bankName: true, bankAccountType: true, bankAccountNumber: true, bankAccountHolder: true, holderIdType: true, holderIdNumber: true };

// Include compartido por las rutas de solicitudes de compra (listar,
// aprobar, recibir, facturar, auditar, corregir) — un solo lugar para no
// tener 6 copias ligeramente distintas del mismo shape.
export const purchaseRequestInclude = {
  catalogItem: { select: { id: true, name: true, photos: true } },
  supplier: { select: { id: true, name: true, bankAccounts: { orderBy: { createdAt: "asc" as const } } } },
  carrier: { select: { id: true, name: true, bankAccounts: { orderBy: { createdAt: "asc" as const } } } },
  bankAccount: { select: bankAccountSelect },
  carrierBankAccount: { select: bankAccountSelect },
  bankAccountChangeRequestedBy: { select: { name: true } },
  requestedBy: { select: { name: true } },
  reviewedBy: { select: { name: true } },
  paidBy: { select: { name: true } },
  invoicedBy: { select: { name: true } },
  shippingPaymentRequestedBy: { select: { name: true } },
  shippingPaidBy: { select: { name: true } },
  financeFlaggedBy: { select: { name: true } },
  receipt: { include: { confirmedBy: { select: { name: true } }, approvedBy: { select: { name: true } }, justaUploadedBy: { select: { name: true } } } },
  urgentReports: {
    orderBy: { reportedAt: "desc" as const },
    include: {
      reportedBy: { select: { name: true } },
      reviewedByLead: { select: { name: true } },
      // Confirmado 2026-08-12: pedido explícito del usuario — Auditoría
      // necesita saber si un reporte urgente ya quedó resuelto del todo
      // (suma de resoluciones COMPLETED cubre el total reportado) para
      // poder excluir del historial cualquier operación que todavía tenga
      // algo pendiente con el proveedor.
      resolutions: { select: { quantity: true, status: true } },
    },
  },
};
