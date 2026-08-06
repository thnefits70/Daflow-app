// Confirmado 2026-08-06: helpers puros para el flujo de "Informar urgente"
// → resolución (crédito/cambio/reembolso/pérdida), sin Prisma — reutilizables
// tanto en el ensamblado server-side como en las rutas que validan cantidades.

export type UrgentReportQuantities = { damagedQty: number; missingQty: number; incompleteQty: number };
export type UrgentResolutionLite = { quantity: number; status: "PENDING" | "COMPLETED" | "CANCELLED" };

export function totalReportedQty(report: UrgentReportQuantities): number {
  return report.damagedQty + report.missingQty + report.incompleteQty;
}

// Cantidad ya "reclamada" por una resolución que no está cancelada — cuenta
// tanto PENDING como COMPLETED, para no dejar que dos resoluciones distintas
// reclamen la misma unidad dos veces mientras una todavía está en curso.
export function claimedQty(resolutions: UrgentResolutionLite[]): number {
  return resolutions.filter((r) => r.status !== "CANCELLED").reduce((s, r) => s + r.quantity, 0);
}

// Solo lo COMPLETED cuenta para considerar el reporte cerrado — un cambio de
// mercadería o un reembolso en curso (PENDING) todavía no cierra nada.
export function resolvedQty(resolutions: UrgentResolutionLite[]): number {
  return resolutions.filter((r) => r.status === "COMPLETED").reduce((s, r) => s + r.quantity, 0);
}

export function remainingUnclaimedQty(report: UrgentReportQuantities, resolutions: UrgentResolutionLite[]): number {
  return Math.max(0, totalReportedQty(report) - claimedQty(resolutions));
}

// Confirmado 2026-08-06: mientras la suma de resoluciones COMPLETED no cubra
// el total reportado, la operación sigue "abierta" — Finanzas ve un aviso,
// no la puede dar por cerrada del todo (sí puede seguir registrando factura
// normalmente para lo que sí llegó bien).
export function isReportOpen(report: UrgentReportQuantities, resolutions: UrgentResolutionLite[]): boolean {
  return resolvedQty(resolutions) < totalReportedQty(report);
}

// Confirmado 2026-08-06: el proveedor solo aprueba crédito por mercadería
// dañada/incompleta/faltante si se reclama dentro de los 7 días siguientes
// al pago ("fecha de compra") — después de eso, no lo acepta. Visible para
// Inventario (Daniel, al reportar), Compras (Bryan, al elegir crédito) y
// Finanzas (Nairoby, en la revisión), cada uno en su propia pantalla.
export const CREDIT_CLAIM_WINDOW_DAYS = 7;

export function creditClaimDeadline(paidAt: Date): Date {
  return new Date(paidAt.getTime() + CREDIT_CLAIM_WINDOW_DAYS * 86400000);
}

export function isWithinCreditClaimWindow(paidAt: Date, now: Date = new Date()): boolean {
  return now <= creditClaimDeadline(paidAt);
}
