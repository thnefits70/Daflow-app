// Pedido de Daniel 2026-10-07 (caso Almohada Sellada al Vacío de CHEN, 200
// un. "Nunca llegó y el proveedor no tiene"): cuando el reporte urgente ya
// revisado cubre TODO lo pedido, no queda nada bueno que registrar
// (registerGoodUnitsFromUrgentReport devuelve null) y la línea se quedaba
// "Pendiente" para siempre en la bandeja de Inventario. Para Inventario ya
// está cerrada: lo que sigue (crédito, reembolso o entrega del faltante) lo
// gestiona Compras desde Reportes urgentes. Sin consultas — sirve igual en el
// servidor y en la pantalla.
type ReportLike = {
  damagedQty: number;
  incompleteQty: number;
  differentQty: number;
  missingQty: number;
  reviewedByLeadAt: Date | string | null;
  rejectedAt?: Date | string | null;
  isLateClaim?: boolean;
};

export function isFullyReportedNotArrived(line: {
  status: string;
  quantity: number;
  receipt?: unknown;
  urgentReports: ReportLike[];
}): boolean {
  if (line.receipt) return false;
  if (line.status !== "PAID" && line.status !== "APPROVED") return false;
  const reports = line.urgentReports.filter((r) => !r.isLateClaim);
  if (reports.length === 0) return false;
  if (reports.some((r) => !r.reviewedByLeadAt || r.rejectedAt)) return false;
  const affected = reports.reduce((s, r) => s + r.damagedQty + r.incompleteQty + r.differentQty + r.missingQty, 0);
  return affected >= line.quantity;
}
