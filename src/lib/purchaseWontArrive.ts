import { randomUUID } from "crypto";
import { prisma } from "@/lib/prisma";
import { notifyOwner } from "@/lib/notifications";
import { getPurchaseApproverIds } from "@/lib/guards";
import { formatPurchaseRequestCode } from "@/lib/purchases";
import { getReservedCreditsForGroup, releaseCreditsForGroup } from "@/lib/supplierCredits";
import { CANCEL_NOT_SENT_PREFIX, cancelNotSentBlocker, nothingArrivedUnpaid, openSupplierStockoutNotice, type CancelNotSentRequest } from "@/lib/purchaseCancelNotSent";

// Pedido de Jariel 2026-10-15 (caso SC-133, Cámara GoPro CHEN: llegaron 40
// de 50 y las otras 10 ya no van a llegar). Solo con proveedores a CRÉDITO,
// en Reportes urgentes, un botón "No llegará — solo se pagará lo que llegó":
//   · Caso 1, no llegó nada → se cancela la compra (lo mismo que "Cancelar
//     compra", ver cancelPurchaseNotSent). No se paga nada.
//   · Caso 2, llegó una parte → lo que falta se cierra como "no se paga":
//     resolución CREDIT ya COMPLETED, que al crear la tanda se descuenta de
//     ESTA misma compra (ver availableCreditsForDebt en supplierDebt.ts). Al
//     proveedor se le paga solo lo que llegó.
// Confirmado por el usuario 2026-10-15: la prueba es el conteo del equipo de
// Inventario confirmado por Daniel (reviewedByLeadAt) — sin captura del
// proveedor. Lo pulsan quien compró, quien gestiona Compras
// (canManagePurchases, hoy Jariel) o el admin.

export const WONT_ARRIVE_PREFIX = "No llegó — solo se paga lo que llegó";

export type WontArriveReport = {
  isLateClaim: boolean;
  reviewedByLeadAt: Date | string | null;
  rejectedAt: Date | string | null;
  resolvedInternallyAt: Date | string | null;
  missingQty: number;
  damagedQty: number;
  incompleteQty: number;
  differentQty: number;
  resolutions: { status: string; quantity: number }[];
  request: CancelNotSentRequest & { supplier: { paymentMode: string } };
};

export type WontArriveMode = { mode: "cancel" } | { mode: "partial"; qty: number } | { mode: null; blocker: string };

export function wontArriveMode(r: WontArriveReport): WontArriveMode {
  const req = r.request;
  if (req.supplier.paymentMode !== "CREDITO") return { mode: null, blocker: "Solo aplica a proveedores a crédito." };
  if (r.isLateClaim) return { mode: null, blocker: "No aplica a un reclamo posterior al cierre." };
  if (r.rejectedAt || r.resolvedInternallyAt) return { mode: null, blocker: "Este reclamo ya está cerrado." };
  if (!r.reviewedByLeadAt) return { mode: null, blocker: "Daniel todavía no confirmó el conteo de este reclamo." };
  if (req.status === "REJECTED") return { mode: null, blocker: "Esta compra ya está cancelada." };
  if (req.paidAt || req.debtPaymentId) return { mode: null, blocker: "Esta compra ya se pagó — lo que corresponde es la devolución del dinero." };
  if (r.missingQty <= 0) return { mode: null, blocker: "Este reclamo no tiene unidades faltantes." };

  if (nothingArrivedUnpaid(req)) {
    const blocker = cancelNotSentBlocker(req);
    return blocker ? { mode: null, blocker } : { mode: "cancel" };
  }
  if (!req.receipt) return { mode: null, blocker: "Primero Inventario tiene que registrar lo que llegó." };

  const total = r.missingQty + r.damagedQty + r.incompleteQty + r.differentQty;
  const claimed = r.resolutions.filter((x) => x.status !== "CANCELLED").reduce((s, x) => s + x.quantity, 0);
  const qty = Math.min(r.missingQty, total - claimed);
  if (qty <= 0) return { mode: null, blocker: "Lo que faltaba ya tiene una solución registrada." };
  return { mode: "partial", qty };
}

// Antes vivía dentro de cancel-not-sent/route.ts (2026-10-10, SC-118). La
// compra queda REJECTED y cerrada; en el enlace y la hoja del proveedor queda
// como "Cancelado: CHEN sin stock". Se separa a un groupId propio si la
// solicitud tiene más productos. Quien llama ya validó permisos y el caso.
export async function cancelPurchaseNotSent(opts: { requestId: string; actorId: string | null; note: string }): Promise<void> {
  const { actorId, note } = opts;
  const r = await prisma.purchaseRequest.findUniqueOrThrow({
    where: { id: opts.requestId },
    include: { catalogItem: { select: { name: true } }, supplier: { select: { name: true } } },
  });
  const now = new Date();
  const siblings = await prisma.purchaseRequest.count({ where: { groupId: r.groupId, id: { not: r.id } } });
  const groupId = siblings > 0 ? randomUUID() : r.groupId;

  await prisma.$transaction([
    prisma.purchaseRequest.update({
      where: { id: r.id },
      data: {
        groupId,
        status: "REJECTED",
        rejectReason: `${CANCEL_NOT_SENT_PREFIX}: ${note}`,
        rejectionClosedAt: now,
        rejectionClosedNote: `${CANCEL_NOT_SENT_PREFIX}: ${note}`,
      },
    }),
    prisma.purchaseRequestUrgentReport.updateMany({
      where: { requestId: r.id, rejectedAt: null, supplierStockoutAt: null, missingQty: { gt: 0 } },
      data: { supplierStockoutAt: now, supplierStockoutById: actorId },
    }),
  ]);

  // Crédito reservado para esa solicitud: si ya no queda nada que pagar (o
  // supera lo que queda), vuelve a quedar libre con el proveedor.
  if (siblings === 0) {
    await releaseCreditsForGroup(r.groupId).catch(() => null);
  } else {
    const keptTotal = (await prisma.purchaseRequest.findMany({ where: { groupId: r.groupId }, select: { totalCost: true } })).reduce((s, x) => s + x.totalCost, 0);
    const reserved = (await getReservedCreditsForGroup(r.groupId)).reduce((s, c) => s + c.amount, 0);
    if (reserved > keptTotal + 0.001) await releaseCreditsForGroup(r.groupId).catch(() => null);
  }

  try {
    await openSupplierStockoutNotice({
      catalogItemId: r.catalogItemId,
      catalogItemName: r.catalogItem.name,
      supplierName: r.supplier.name,
      qty: r.quantity,
      reporterId: actorId ?? r.requestedById,
    });
  } catch (err) {
    console.error("[cancel-not-sent] aviso a marketing:", err);
  }

  const code = r.requestNumber ? `${formatPurchaseRequestCode(r.requestNumber)} · ` : "";
  const body = `${code}${r.catalogItem.name} (${r.quantity} un.) · ${r.supplier.name} — el proveedor no la envió: ${note}. No se paga nada.`;
  await notifyWontArrive({ title: "🚫 Compra cancelada (solo aviso)", body, requestedById: r.requestedById, actorId });
}

// Caso 2: llegó una parte. Lo que falta queda como "no se paga" y se
// descuenta de esta misma compra al pagarla. Sin captura: la prueba es el
// conteo de Inventario confirmado por Daniel.
export async function closeMissingPayOnlyArrived(opts: { reportId: string; qty: number; actorId: string | null; note: string }): Promise<void> {
  const { reportId, qty, actorId, note } = opts;
  const report = await prisma.purchaseRequestUrgentReport.findUniqueOrThrow({
    where: { id: reportId },
    select: {
      supplierStockoutAt: true,
      request: {
        select: {
          supplierId: true,
          catalogItemId: true,
          unitCost: true,
          quantity: true,
          requestNumber: true,
          requestedById: true,
          catalogItem: { select: { name: true } },
          supplier: { select: { name: true } },
        },
      },
    },
  });
  const r = report.request;
  const amount = Math.round(qty * r.unitCost * 100) / 100;
  const now = new Date();

  await prisma.$transaction(async (tx) => {
    const res = await tx.purchaseUrgentResolution.create({
      data: { reportId, type: "CREDIT", quantity: qty, amount, status: "COMPLETED", note: `${WONT_ARRIVE_PREFIX}: ${note}`, createdById: actorId },
    });
    await tx.supplierCredit.create({
      data: {
        supplierId: r.supplierId,
        amount,
        reason: `${WONT_ARRIVE_PREFIX} — ${r.catalogItem.name} (${qty} un. no llegaron; se descuenta al pagar esta compra). Prueba: conteo de Inventario confirmado por Daniel. ${note}`,
        urgentResolutionId: res.id,
        status: "AVAILABLE",
        createdById: actorId,
      },
    });
    if (!report.supplierStockoutAt) {
      await tx.purchaseRequestUrgentReport.update({ where: { id: reportId }, data: { supplierStockoutAt: now, supplierStockoutById: actorId } });
    }
  });

  try {
    await openSupplierStockoutNotice({
      catalogItemId: r.catalogItemId,
      catalogItemName: r.catalogItem.name,
      supplierName: r.supplier.name,
      qty,
      reporterId: actorId ?? r.requestedById,
    });
  } catch (err) {
    console.error("[wont-arrive] aviso a marketing:", err);
  }

  const code = r.requestNumber ? `${formatPurchaseRequestCode(r.requestNumber)} · ` : "";
  const body = `${code}${r.catalogItem.name} · ${r.supplier.name} — ${qty} de ${r.quantity} un. no van a llegar: ${note}. Se paga solo lo que llegó (se descuentan $${amount.toFixed(2)}).`;
  await notifyWontArrive({ title: "🚫 No llegará: se paga solo lo que llegó (solo aviso)", body, requestedById: r.requestedById, actorId });
}

// Solo aviso: a quien aprueba compras y a quien compró (si no lo hizo él).
async function notifyWontArrive(opts: { title: string; body: string; requestedById: string | null; actorId: string | null }) {
  const notifyIds = new Set(await getPurchaseApproverIds());
  if (opts.requestedById) notifyIds.add(opts.requestedById);
  if (opts.actorId) notifyIds.delete(opts.actorId);
  for (const ownerId of notifyIds) {
    await notifyOwner(ownerId, { title: opts.title, body: opts.body, url: "/area/workspace?tab=compras" }).catch(() => null);
  }
}

export async function canMarkWontArrive(opts: { userId: string; isAdmin: boolean; requestedById: string | null }): Promise<boolean> {
  if (opts.isAdmin || opts.userId === opts.requestedById) return true;
  const user = await prisma.user.findUnique({ where: { id: opts.userId }, select: { canManagePurchases: true, isActive: true } });
  return !!user?.isActive && !!user.canManagePurchases;
}
