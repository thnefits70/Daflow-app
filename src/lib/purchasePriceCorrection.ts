import { prisma } from "@/lib/prisma";
import { getCurrentStock, applyPriceCorrection } from "@/lib/stockKardex";
import { formatPurchaseRequestCode } from "@/lib/purchases";

// Confirmado 2026-09-29, pedido del usuario (caso pistola de pintura: Bryan
// negoció $10 con CHEN, pero Jariel ya había ingresado la solicitud a
// $10.50 y estaba aprobada): corregir el precio de una compra YA aprobada
// que todavía no se pagó. Jariel o Bryan lo PIDEN con la captura del
// acuerdo; SOLO el admin aprueba (subir o bajar). Al aprobar, todo queda
// conectado solo: la solicitud (de ahí sale la deuda y la hoja de CHEN) y,
// si ya entró al Kardex, una línea PRICE_CORRECTION que corrige el costo
// promedio de lo que sigue en bodega. Nada se borra — el antes/ahora queda
// en PurchasePriceCorrection.

const CORRECTABLE_STATUSES = ["APPROVED", "RECEIVED_PENDING_REVIEW", "RECEIVED"] as const;

// Por qué una solicitud NO se puede corregir (null = sí se puede).
function blockReason(r: {
  status: string;
  paidAt: Date | null;
  debtPaymentId: string | null;
  urgentReports: { resolutions: { status: string }[] }[];
}): string | null {
  if (!(CORRECTABLE_STATUSES as readonly string[]).includes(r.status)) return "Solo se corrige una compra aprobada que todavía no se pagó.";
  if (r.paidAt || r.debtPaymentId) return "Esta compra ya se pagó (o ya está en una tanda de pago) — su precio no se puede cambiar.";
  // El monto de un crédito/cambio/reembolso ya registrado se calculó con el
  // precio viejo — cambiarlo ahora descuadraría esos montos.
  if (r.urgentReports.some((u) => u.resolutions.some((res) => res.status !== "CANCELLED"))) {
    return "Esta compra ya tiene un reclamo resuelto con el precio actual (crédito, cambio, reembolso o pérdida). Habla con el admin.";
  }
  return null;
}

const eligibilityInclude = {
  urgentReports: { select: { resolutions: { select: { status: true } } } },
  priceCorrections: { where: { status: "PENDING" as const }, select: { id: true } },
} as const;

export type PriceCorrectableRequest = {
  id: string;
  code: string | null;
  productName: string;
  supplierName: string;
  quantity: number;
  unitCost: number;
  status: string;
  requestedAt: string;
};

export async function getPriceCorrectableRequests(): Promise<PriceCorrectableRequest[]> {
  const rows = await prisma.purchaseRequest.findMany({
    where: { status: { in: [...CORRECTABLE_STATUSES] }, paidAt: null, debtPaymentId: null },
    include: { ...eligibilityInclude, catalogItem: { select: { name: true } }, supplier: { select: { name: true } } },
    orderBy: { requestedAt: "desc" },
    take: 300,
  });
  return rows
    .filter((r) => r.priceCorrections.length === 0 && !blockReason(r))
    .map((r) => ({
      id: r.id,
      code: r.requestNumber ? formatPurchaseRequestCode(r.requestNumber) : null,
      productName: r.catalogItem.name,
      supplierName: r.supplier.name,
      quantity: r.quantity,
      unitCost: r.unitCost,
      status: r.status,
      requestedAt: r.requestedAt.toISOString(),
    }));
}

export async function submitPriceCorrection(params: {
  requestId: string;
  newUnitCost: number;
  reason: string;
  proofUrl: string;
  proofName: string | null;
  requestedById: string | null;
  proofHash: string | null;
  proofAiCheck: unknown;
  proofMismatchNote: string | null;
}) {
  if (!(params.newUnitCost > 0)) throw new Error("El precio nuevo debe ser mayor a 0.");
  const reason = params.reason.trim();
  if (!reason) throw new Error("Explica qué se negoció con el proveedor.");
  const request = await prisma.purchaseRequest.findUnique({
    where: { id: params.requestId },
    include: { ...eligibilityInclude, catalogItem: { select: { name: true } }, supplier: { select: { name: true } } },
  });
  if (!request) throw new Error("Solicitud no encontrada.");
  const blocked = blockReason(request);
  if (blocked) throw new Error(blocked);
  if (request.priceCorrections.length > 0) throw new Error("Esta compra ya tiene una corrección de precio esperando al admin.");
  const newUnitCost = Math.round(params.newUnitCost * 10000) / 10000;
  if (Math.abs(newUnitCost - request.unitCost) < 0.00005) throw new Error("El precio nuevo es igual al actual.");

  const correction = await prisma.purchasePriceCorrection.create({
    data: {
      requestId: request.id,
      oldUnitCost: request.unitCost,
      newUnitCost,
      reason,
      proofUrl: params.proofUrl,
      proofName: params.proofName,
      proofHash: params.proofHash,
      proofAiCheck: params.proofAiCheck ? JSON.parse(JSON.stringify(params.proofAiCheck)) : undefined,
      proofMismatchNote: params.proofMismatchNote,
      requestedById: params.requestedById,
    },
  });
  return { correction, request };
}

export type PriceCorrectionRow = {
  id: string;
  requestId: string;
  code: string | null;
  productName: string;
  supplierName: string;
  quantity: number;
  oldUnitCost: number;
  newUnitCost: number;
  reason: string;
  proofUrl: string;
  proofName: string | null;
  proofMismatchNote: string | null;
  status: "PENDING" | "APPROVED" | "REJECTED";
  rejectReason: string | null;
  requestedByName: string | null;
  requestedAt: string;
  reviewedAt: string | null;
  kardexAdjustedUnits: number | null;
  inKardex: boolean;
};

export async function getPriceCorrections(): Promise<PriceCorrectionRow[]> {
  const rows = await prisma.purchasePriceCorrection.findMany({
    orderBy: { requestedAt: "desc" },
    take: 200,
    include: {
      requestedBy: { select: { name: true } },
      request: {
        select: {
          requestNumber: true,
          quantity: true,
          catalogItem: { select: { name: true } },
          supplier: { select: { name: true } },
          receipt: { select: { stockKardexEntry: { select: { id: true } } } },
        },
      },
    },
  });
  return rows.map((c) => ({
    id: c.id,
    requestId: c.requestId,
    code: c.request.requestNumber ? formatPurchaseRequestCode(c.request.requestNumber) : null,
    productName: c.request.catalogItem.name,
    supplierName: c.request.supplier.name,
    quantity: c.request.quantity,
    oldUnitCost: c.oldUnitCost,
    newUnitCost: c.newUnitCost,
    reason: c.reason,
    proofUrl: c.proofUrl,
    proofName: c.proofName,
    proofMismatchNote: c.proofMismatchNote,
    status: c.status,
    rejectReason: c.rejectReason,
    requestedByName: c.requestedBy?.name ?? null,
    requestedAt: c.requestedAt.toISOString(),
    reviewedAt: c.reviewedAt?.toISOString() ?? null,
    kardexAdjustedUnits: c.kardexAdjustedUnits,
    inKardex: !!c.request.receipt?.stockKardexEntry,
  }));
}

export async function countPendingPriceCorrections() {
  return prisma.purchasePriceCorrection.count({ where: { status: "PENDING" } });
}

export async function rejectPriceCorrection(id: string, rejectReason: string) {
  const reasonText = rejectReason.trim();
  if (!reasonText) throw new Error("Escribe por qué la rechazas.");
  const updated = await prisma.purchasePriceCorrection.updateMany({
    where: { id, status: "PENDING" },
    data: { status: "REJECTED", rejectReason: reasonText, reviewedAt: new Date() },
  });
  if (updated.count === 0) throw new Error("Esta corrección ya fue revisada.");
  return prisma.purchasePriceCorrection.findUniqueOrThrow({
    where: { id },
    include: { request: { select: { catalogItem: { select: { name: true } } } } },
  });
}

// Aprueba y aplica. El precio "antes" se vuelve a tomar del vigente en la
// solicitud (por si cambió mientras esperaba). Si la compra ya entró al
// Kardex, la diferencia por unidad se aplica solo a las unidades de esa
// compra que siguen en bodega: nuevo promedio = (saldo × promedio +
// unidades × diferencia) ÷ saldo. Si todavía no entró (Daniel no aprobó o
// espera el ID de Dropi), no hace falta línea: entrará ya con el precio nuevo.
export async function approvePriceCorrection(id: string) {
  const correction = await prisma.purchasePriceCorrection.findUnique({
    where: { id },
    include: {
      request: {
        include: {
          ...eligibilityInclude,
          catalogItem: { select: { name: true } },
          receipt: { select: { stockKardexEntry: { select: { id: true, type: true, quantity: true } } } },
        },
      },
    },
  });
  if (!correction) throw new Error("Corrección no encontrada.");
  if (correction.status !== "PENDING") throw new Error("Esta corrección ya fue revisada.");
  const request = correction.request;
  const blocked = blockReason(request);
  if (blocked) throw new Error(blocked);

  const oldUnitCost = request.unitCost;
  const newUnitCost = correction.newUnitCost;
  const delta = newUnitCost - oldUnitCost;
  const kardexIn = request.receipt?.stockKardexEntry?.type === "IN" ? request.receipt.stockKardexEntry : null;

  let kardexLine: { units: number; balance: number; avgCostAfter: number } | null = null;
  if (kardexIn) {
    const current = await getCurrentStock(request.catalogItemId);
    const units = Math.max(0, Math.min(kardexIn.quantity, current.balance));
    kardexLine = { units, balance: current.balance, avgCostAfter: applyPriceCorrection(current.balance, current.avgCost, delta, units) };
  }

  await prisma.$transaction(async (tx) => {
    // Todo o nada: si en este mismo instante se metió en una tanda o se
    // pagó, no se toca nada.
    const claimed = await tx.purchaseRequest.updateMany({
      where: { id: request.id, paidAt: null, debtPaymentId: null, unitCost: oldUnitCost },
      data: { unitCost: newUnitCost, totalCost: Math.round(request.quantity * newUnitCost * 100) / 100 },
    });
    if (claimed.count !== 1) throw new Error("La compra cambió mientras tanto (se pagó o cambió el precio). Vuelve a cargar.");

    let kardexEntryId: string | null = null;
    if (kardexLine) {
      const entry = await tx.stockKardexEntry.create({
        data: {
          catalogItemId: request.catalogItemId,
          type: "PRICE_CORRECTION",
          quantity: 0,
          unitCost: delta,
          balanceAfter: kardexLine.balance,
          avgCostAfter: kardexLine.avgCostAfter,
          occurredAt: new Date(),
        },
      });
      kardexEntryId = entry.id;
    }

    const done = await tx.purchasePriceCorrection.updateMany({
      where: { id, status: "PENDING" },
      data: {
        status: "APPROVED",
        oldUnitCost,
        reviewedAt: new Date(),
        kardexEntryId,
        kardexAdjustedUnits: kardexLine ? kardexLine.units : null,
      },
    });
    if (done.count !== 1) throw new Error("Esta corrección ya fue revisada.");
  });

  return { correction, productName: request.catalogItem.name, oldUnitCost, newUnitCost, kardexUnits: kardexLine?.units ?? null };
}
