import { SupplierShippingPhotoCapture } from "@/components/supplier-ledger/SupplierShippingPhotoCapture";
import { SupplierShipmentConfirmButton } from "@/components/supplier-ledger/SupplierShipmentConfirmButton";

export type PendingShipmentRow = {
  id: string;
  approvedAt: Date;
  productName: string;
  productImageUrl: string | null;
  quantity: number;
  requestedByName: string | null;
  approvedByName: string | null;
  photoUrl: string | null;
};

const DATE_FMT = new Intl.DateTimeFormat("es-EC", {
  timeZone: "America/Guayaquil",
  weekday: "short",
  day: "2-digit",
  month: "short",
  year: "numeric",
  hour: "2-digit",
  minute: "2-digit",
});
const SHORT_DATE_FMT = new Intl.DateTimeFormat("es-EC", {
  timeZone: "America/Guayaquil",
  weekday: "short",
  day: "2-digit",
  month: "short",
  hour: "2-digit",
  minute: "2-digit",
});

export function ProductThumb({ url, alt, size = "md" }: { url: string | null; alt: string; size?: "sm" | "md" }) {
  const box = size === "sm" ? "w-12 h-12" : "w-14 h-14";
  if (!url) {
    return <div className={`${box} shrink-0 rounded-lg border border-neutral-200 bg-neutral-100`} />;
  }
  return (
    // eslint-disable-next-line @next/next/no-img-element
    <img src={url} alt={alt} className={`${box} shrink-0 object-cover rounded-lg border border-neutral-200 bg-white`} />
  );
}

// Confirmado 2026-09-22, pedido explícito del usuario: los dos enlaces de
// CHEN (saldo y despacho) solo se veían bien en computadora — en el celular
// la tabla de 8 columnas se cortaba y había que deslizar de lado para llegar
// al botón "Ya lo enviamos". Ahora en celular cada pedido es una tarjeta
// compacta (foto, nombre, cantidad grande, botones abajo) y en pantallas
// medianas en adelante se mantiene la tabla de siempre. Un solo componente
// para ambos enlaces, así nunca se desalinean.
export function SupplierPendingShipmentsList({ token, rows }: { token: string; rows: PendingShipmentRow[] }) {
  if (rows.length === 0) {
    return <p className="rounded-xl border border-dashed border-neutral-300 bg-white px-4 py-6 text-center text-sm text-neutral-400">No hay pedidos pendientes de envío por ahora.</p>;
  }

  const th = "px-3 py-2 whitespace-nowrap";
  const td = "px-3 py-2 whitespace-nowrap";

  return (
    <>
      {/* Celular: tarjetas */}
      <ul className="space-y-2.5 md:hidden">
        {rows.map((r) => (
          <li key={r.id} className="rounded-xl border border-neutral-200 bg-white p-3 shadow-sm">
            <div className="flex gap-3">
              <ProductThumb url={r.productImageUrl} alt={r.productName} />
              <div className="min-w-0 flex-1">
                <div className="flex items-start justify-between gap-2">
                  <p className="text-sm font-medium leading-snug text-neutral-900">{r.productName}</p>
                  <span className="shrink-0 rounded-md bg-neutral-900 px-2 py-0.5 text-sm font-semibold tabular-nums text-white">{r.quantity}</span>
                </div>
                <p className="mt-1 text-xs text-neutral-500">Aprobado {SHORT_DATE_FMT.format(r.approvedAt)}</p>
                <p className="text-xs text-neutral-500">
                  Solicitó <span className="text-neutral-700">{r.requestedByName ?? "—"}</span> · Aprobó{" "}
                  <span className="text-neutral-700">{r.approvedByName ?? "—"}</span>
                </p>
              </div>
            </div>
            <div className="mt-3 flex flex-wrap items-start justify-between gap-2 border-t border-neutral-100 pt-3">
              <SupplierShippingPhotoCapture token={token} requestId={r.id} initialPhotoUrl={r.photoUrl} />
              <SupplierShipmentConfirmButton token={token} requestId={r.id} />
            </div>
          </li>
        ))}
      </ul>

      {/* Computadora: tabla */}
      <div className="hidden overflow-x-auto rounded-xl border border-neutral-200 bg-white shadow-sm md:block">
        <table className="w-full text-left text-sm">
          <thead className="border-b border-neutral-200 bg-neutral-50 text-xs uppercase tracking-wide text-neutral-500">
            <tr>
              <th className={th}>Fecha aprobado</th>
              <th className={th}>Imagen</th>
              <th className="px-3 py-2 min-w-[200px]">Producto</th>
              <th className={`${th} text-right`}>Cant.</th>
              <th className={th}>Solicitado por</th>
              <th className={th}>Aprobado por</th>
              <th className={th}>Foto (opcional)</th>
              <th className={th}>¿Ya lo enviaron?</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-neutral-100">
            {rows.map((r) => (
              <tr key={r.id}>
                <td className={`${td} text-neutral-600`}>{DATE_FMT.format(r.approvedAt)}</td>
                <td className="px-3 py-2">
                  <ProductThumb url={r.productImageUrl} alt={r.productName} size="sm" />
                </td>
                <td className="px-3 py-2">{r.productName}</td>
                <td className={`${td} text-right tabular-nums`}>{r.quantity}</td>
                <td className={`${td} text-neutral-600`}>{r.requestedByName ?? "—"}</td>
                <td className={`${td} text-neutral-600`}>{r.approvedByName ?? "—"}</td>
                <td className="px-3 py-2">
                  <SupplierShippingPhotoCapture token={token} requestId={r.id} initialPhotoUrl={r.photoUrl} />
                </td>
                <td className="px-3 py-2">
                  <SupplierShipmentConfirmButton token={token} requestId={r.id} />
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </>
  );
}
