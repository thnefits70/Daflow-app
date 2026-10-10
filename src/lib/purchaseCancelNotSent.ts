import { prisma } from "@/lib/prisma";
import { notifySupplierStockoutReported } from "@/lib/supplierStockout";

// Pedido del usuario 2026-10-10 (SC-118, almohada sellada al vacío, CHEN):
// el proveedor nunca envió NADA de una compra aprobada y no la va a enviar
// (no tiene stock). Antes la única salida era "No se paga (se descuenta en
// la tanda)", que crea un saldo a favor con el proveedor por plata que
// nunca se le pagó — después se descontaba de otra compra. Ahora se cancela
// la compra: sin saldo a favor, sin descuento, y sale del enlace del
// proveedor. Solo quien compró (o el admin), con doble confirmación.

export type CancelNotSentRequest = {
  status: string;
  quantity: number;
  paidAt: Date | string | null;
  debtPaymentId: string | null;
  receipt: { id: string } | null;
  urgentReports: {
    rejectedAt: Date | string | null;
    isLateClaim: boolean;
    damagedQty: number;
    incompleteQty: number;
    differentQty: number;
    missingQty: number;
    excessQty: number;
    resolutions: { status: string }[];
  }[];
};

// null = se puede cancelar. Si no, el motivo (lo devuelve la API).
export function cancelNotSentBlocker(r: CancelNotSentRequest): string | null {
  if (r.status !== "APPROVED") return "Solo se cancela una compra aprobada que todavía no se pagó ni se recibió.";
  if (r.paidAt || r.debtPaymentId) return "Esta compra ya se pagó — lo que corresponde es la devolución del dinero.";
  if (r.receipt) return "Esta compra ya tiene una recepción en bodega — algo sí llegó.";
  const reports = r.urgentReports.filter((u) => !u.rejectedAt);
  const missing = reports.filter((u) => !u.isLateClaim).reduce((s, u) => s + u.missingQty, 0);
  if (missing < r.quantity) return "Solo se cancela cuando no llegó ninguna unidad.";
  if (reports.some((u) => u.damagedQty + u.incompleteQty + u.differentQty + u.excessQty > 0)) return "Este reclamo tiene unidades que sí llegaron.";
  if (reports.some((u) => u.resolutions.some((res) => res.status !== "CANCELLED"))) return "Ya se registró una resolución en este reclamo — anúlala primero.";
  return null;
}

// Aviso a Marketing (cerrar el ID en Dropi o bajar el stock) — se crea solo
// si no hay ya uno abierto de ese producto. Lo usan "El proveedor no tiene
// stock" y la cancelación.
export async function openSupplierStockoutNotice(opts: {
  catalogItemId: string;
  catalogItemName: string;
  supplierName: string;
  qty: number;
  reporterId: string | null;
}): Promise<void> {
  if (!opts.reporterId) return;
  const alreadyOpen = await prisma.supplierStockoutReport.findFirst({
    where: { catalogItemId: opts.catalogItemId, resolvedAt: null },
    select: { id: true },
  });
  if (alreadyOpen) return;
  const instructionNote = `${opts.supplierName} no tiene stock — ${opts.qty} un. no van a llegar. Revisen si cerrar el ID en Dropi o bajar el stock.`;
  const created = await prisma.supplierStockoutReport.create({
    data: { catalogItemId: opts.catalogItemId, instructionNote, reportedById: opts.reporterId },
    include: { reportedBy: { select: { name: true } } },
  });
  await notifySupplierStockoutReported({ catalogItemName: opts.catalogItemName, instructionNote, reportedByName: created.reportedBy.name });
}
