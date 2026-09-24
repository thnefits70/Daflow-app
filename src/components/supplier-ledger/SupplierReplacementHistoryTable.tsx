import { firstName } from "@/lib/actorName";
import type { SupplierReplacementHistoryItem } from "@/lib/supplierDebt";

// Confirmado 2026-09-24, pedido explícito del usuario: historial de solo
// lectura de los faltantes/cambios que CHEN ya repuso y la bodega TBS
// aprobó — mismo en el enlace del saldo y en el de envíos (sin $ en ambos).

const DATE_FMT = new Intl.DateTimeFormat("es-EC", {
  timeZone: "America/Guayaquil",
  weekday: "short",
  day: "2-digit",
  month: "short",
  year: "numeric",
  hour: "2-digit",
  minute: "2-digit",
});
const SHORT_DATE_FMT = new Intl.DateTimeFormat("es-EC", { timeZone: "America/Guayaquil", weekday: "short", day: "2-digit", month: "short" });

function fmt(d: Date | null, f: Intl.DateTimeFormat) {
  return d ? f.format(d) : "—";
}

function kindLabel(i: SupplierReplacementHistoryItem) {
  return i.isMissingDelivery ? "Faltante" : "Cambio";
}

export function SupplierReplacementHistoryTable({ items }: { items: SupplierReplacementHistoryItem[] }) {
  if (items.length === 0) {
    return (
      <p className="rounded-xl border border-dashed border-neutral-300 bg-white px-4 py-6 text-center text-sm text-neutral-400">
        Todavía no hay faltantes ni cambios repuestos.
      </p>
    );
  }
  const th = "px-3 py-2 whitespace-nowrap";
  const td = "px-3 py-2 whitespace-nowrap";
  return (
    <>
      {/* Celular */}
      <ul className="divide-y divide-neutral-100 overflow-hidden rounded-xl border border-neutral-200 bg-white shadow-sm md:hidden">
        {items.map((i) => (
          <li key={i.id} className="p-3">
            <div className="flex items-start justify-between gap-2">
              <p className="text-sm font-medium leading-snug">{i.productName}</p>
              <span className="shrink-0 text-sm tabular-nums">{i.quantity} un.</span>
            </div>
            <p className="mt-0.5 text-xs text-neutral-500">
              {kindLabel(i)} · Ustedes enviaron: {fmt(i.supplierShippedAt, SHORT_DATE_FMT)} · Llegó: {fmt(i.arrivedAt, SHORT_DATE_FMT)}
            </p>
            <p className="text-xs font-medium text-emerald-700">
              Aprobado {fmt(i.completedAt, SHORT_DATE_FMT)} por {firstName(i.completedByName) || "—"}
            </p>
          </li>
        ))}
      </ul>
      {/* Computadora */}
      <div className="hidden overflow-x-auto rounded-xl border border-neutral-200 bg-white shadow-sm md:block">
        <table className="w-full text-left text-sm">
          <thead className="border-b border-neutral-200 text-xs uppercase tracking-wide text-neutral-500">
            <tr>
              <th className="px-3 py-2 min-w-[200px]">Producto</th>
              <th className={th}>Tipo</th>
              <th className={`${th} text-right`}>Cant.</th>
              <th className={th}>Ustedes lo enviaron</th>
              <th className={th}>Llegó a la bodega TBS</th>
              <th className={th}>Aprobado</th>
              <th className={th}>Aprobado por</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-neutral-100">
            {items.map((i) => (
              <tr key={i.id}>
                <td className="px-3 py-2">{i.productName}</td>
                <td className={`${td} text-neutral-600`}>{kindLabel(i)}</td>
                <td className={`${td} text-right tabular-nums`}>{i.quantity}</td>
                <td className={`${td} text-neutral-600`}>{fmt(i.supplierShippedAt, DATE_FMT)}</td>
                <td className={`${td} text-neutral-600`}>{fmt(i.arrivedAt, DATE_FMT)}</td>
                <td className={`${td} font-medium text-emerald-700`}>{fmt(i.completedAt, DATE_FMT)}</td>
                <td className={`${td} text-neutral-600`}>{firstName(i.completedByName) || "—"}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </>
  );
}
