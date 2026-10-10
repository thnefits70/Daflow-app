import type { SupplierCancelledOrder } from "@/lib/purchaseCancelNotSent";
import { ProductThumb } from "@/components/supplier-ledger/SupplierPendingShipmentsList";

// Pedido del usuario 2026-10-10 (SC-118): una compra cancelada porque el
// proveedor no tenía stock no desaparece de sus enlaces — queda acá, de solo
// lectura, con un estado corto. Mismo en el enlace del saldo y en el de envíos.

const SHORT_DATE_FMT = new Intl.DateTimeFormat("es-EC", { timeZone: "America/Guayaquil", weekday: "short", day: "2-digit", month: "short" });

export function SupplierCancelledOrdersTable({ items, label }: { items: SupplierCancelledOrder[]; label: string }) {
  return (
    <ul className="divide-y divide-neutral-100 overflow-hidden rounded-xl border border-neutral-200 bg-white shadow-sm">
      {items.map((i) => (
        <li key={i.id} className="flex items-center gap-3 p-3">
          <ProductThumb url={i.productImageUrl} alt={i.productName} size="sm" />
          <div className="min-w-0 flex-1">
            <p className="text-sm font-medium leading-snug">{i.productName}</p>
            <p className="mt-0.5 text-xs text-neutral-500">
              {i.quantity} uds · pedido del {SHORT_DATE_FMT.format(i.requestedAt)}
              {i.cancelledAt && ` · cancelado el ${SHORT_DATE_FMT.format(i.cancelledAt)}`}
            </p>
          </div>
          <span className="shrink-0 rounded-full bg-neutral-100 px-2.5 py-1 text-xs font-semibold text-neutral-600">{label}</span>
        </li>
      ))}
    </ul>
  );
}
