import { formatPurchaseRequestCode } from "@/lib/purchaseCode";

// Pedido de Daniel 2026-10-14: el código SC-XXX de la compra se ve en todas
// las pantallas del flujo, desde el pedido hasta el cierre de la auditoría.
export function PurchaseCode({ requestNumber, className = "" }: { requestNumber: number | null | undefined; className?: string }) {
  if (requestNumber == null) return null;
  return <span className={`font-mono text-[10.5px] text-steel shrink-0 ${className}`}>{formatPurchaseRequestCode(requestNumber)}</span>;
}
