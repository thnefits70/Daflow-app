import { firstName } from "@/lib/actorName";
import type { SupplierDebtDisputedItem } from "@/lib/supplierDebt";
import { SupplierShipmentConfirmButton } from "@/components/supplier-ledger/SupplierShipmentConfirmButton";

// Confirmado 2026-09-24, pedido explícito del usuario: la misma sección de
// "Mercadería en revisión" se muestra en el enlace del saldo y en el de
// "Pedidos por enviar" (equipo de despacho de CHEN), para que sepan qué
// reemplazo les falta enviar. showValue=false en el de envíos: ese enlace
// nunca muestra plata (ver proveedor-ledger/envios/[token]).

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

const DAY_FMT = new Intl.DateTimeFormat("es-EC", { timeZone: "America/Guayaquil", weekday: "short", day: "2-digit", month: "short" });

// Confirmado 2026-09-24, pedido explícito del usuario: CHEN ve en qué paso va
// cada fila, siempre según la operación real — si nunca aprietan "ya lo
// enviamos" pero Inventario ya lo recibió, igual pasa a "ya llegó", y con la
// aprobación de Daniel la fila desaparece (ver getSupplierDebtDisputedItems).
function DisputeStatus({ item, token }: { item: SupplierDebtDisputedItem; token: string }) {
  if (item.damageConfirmPending) return <span className="text-amber-700">La bodega TBS está revisando lo que llegó.</span>;
  if (item.awaitingCoordination) return <span className="text-amber-700">TBS está coordinando con ustedes cómo se resuelve.</span>;
  return (
    <div className="flex flex-col gap-2">
      {item.replacements.map((r) => {
        const what = r.isMissingDelivery ? "faltantes" : "de cambio";
        if (r.arrivedAt) {
          return (
            <span key={r.id} className="font-medium text-emerald-700">
              Ya llegó a la bodega TBS ({r.quantity} un., {DAY_FMT.format(r.arrivedAt)}) — en revisión final.
            </span>
          );
        }
        if (r.supplierShippedAt) {
          return (
            <span key={r.id} className="text-sky-700">
              Ustedes marcaron enviado ({r.quantity} un., {DAY_FMT.format(r.supplierShippedAt)}). Esperando que llegue a la bodega TBS.
            </span>
          );
        }
        return (
          <div key={r.id} className="flex flex-col items-start gap-1">
            <span className="font-semibold text-amber-900">
              Enviar {r.quantity} un. {what}
              {r.dueDate && ` hasta el ${DAY_FMT.format(r.dueDate)}`}
            </span>
            <SupplierShipmentConfirmButton token={token} requestId={r.id} kind="resolution" label="Ya lo enviamos" />
          </div>
        );
      })}
    </div>
  );
}

function money(n: number) {
  return `$${n.toLocaleString("es-EC", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

function damageConfirmedLabel(i: { damageConfirmPending: boolean; damageConfirmedByName: string | null }) {
  return i.damageConfirmPending ? "Pendiente del líder de bodega" : firstName(i.damageConfirmedByName) || "—";
}

// Confirmado 2026-09-24: faltaba "faltantes" (missingQty) — un reporte con
// solo faltante dejaba la columna Detalle vacía.
function disputeDetail(i: { damagedQty: number; incompleteQty: number; differentQty: number; missingQty: number }) {
  return [
    i.missingQty > 0 ? `${i.missingQty} faltantes` : null,
    i.damagedQty > 0 ? `${i.damagedQty} dañadas` : null,
    i.incompleteQty > 0 ? `${i.incompleteQty} incompletas` : null,
    i.differentQty > 0 ? `${i.differentQty} distintas` : null,
  ]
    .filter(Boolean)
    .join(", ");
}

export function SupplierDisputedItemsTable({ items, showValue, token }: { items: SupplierDebtDisputedItem[]; showValue: boolean; token: string }) {
  const th = "px-3 py-2 whitespace-nowrap";
  const td = "px-3 py-2 whitespace-nowrap";
  return (
    <>
      {/* Celular */}
      <ul className="divide-y divide-amber-100 overflow-hidden rounded-xl border border-amber-200 bg-amber-50 shadow-sm md:hidden">
        {items.map((i) => (
          <li key={i.id} className="p-3 text-amber-900">
            <div className="flex items-start justify-between gap-2">
              <p className="text-sm font-medium leading-snug">{i.productName}</p>
              {showValue && <span className="shrink-0 text-sm font-semibold tabular-nums">{money(i.wouldBeValue)}</span>}
            </div>
            <p className="mt-0.5 text-xs text-amber-800">
              {i.quantity} uds{disputeDetail(i) && ` · ${disputeDetail(i)}`}
            </p>
            {i.damageDescriptions.map((d, idx) => (
              <p key={idx} className="text-xs font-medium text-amber-900">
                {d}
              </p>
            ))}
            <p className="text-xs text-amber-700">
              {SHORT_DATE_FMT.format(i.requestedAt)} · Compra aprobada por {firstName(i.approvedByName) || "—"} · Recibió{" "}
              {firstName(i.reviewedByName) || "—"}
            </p>
            <p className="text-xs text-amber-700">Daño confirmado por: {damageConfirmedLabel(i)}</p>
            <div className="mt-2 rounded-lg border border-amber-200 bg-white/60 px-2.5 py-2 text-xs">
              <DisputeStatus item={i} token={token} />
            </div>
          </li>
        ))}
      </ul>
      {/* Computadora */}
      <div className="hidden overflow-x-auto rounded-xl border border-amber-200 bg-amber-50 shadow-sm md:block">
        <table className="w-full text-left text-sm">
          <thead className="border-b border-amber-200 text-xs uppercase tracking-wide text-amber-700">
            <tr>
              <th className={th}>Fecha</th>
              <th className="px-3 py-2 min-w-[200px]">Producto</th>
              <th className={`${th} text-right`}>Cant.</th>
              <th className="px-3 py-2">Detalle</th>
              {showValue && <th className={`${th} text-right`}>Valor si se resuelve</th>}
              <th className={th}>Compra aprobada por</th>
              <th className={th}>Recibido por</th>
              <th className={th}>Daño confirmado por</th>
              <th className="px-3 py-2 min-w-[220px]">Estado</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-amber-100">
            {items.map((i) => (
              <tr key={i.id}>
                <td className={`${td} text-amber-800`}>{DATE_FMT.format(i.requestedAt)}</td>
                <td className="px-3 py-2 text-amber-900">{i.productName}</td>
                <td className={`${td} text-right tabular-nums text-amber-800`}>{i.quantity}</td>
                <td className="px-3 py-2 text-amber-800">
                  {disputeDetail(i) && <span className="block text-xs font-semibold text-amber-900">{disputeDetail(i)}</span>}
                  {i.damageDescriptions.map((d, idx) => (
                    <span key={idx} className="block whitespace-pre-line">
                      {d}
                    </span>
                  ))}
                  {!disputeDetail(i) && i.damageDescriptions.length === 0 && "—"}
                </td>
                {showValue && <td className={`${td} text-right tabular-nums text-amber-800`}>{money(i.wouldBeValue)}</td>}
                <td className={`${td} text-amber-800`}>{firstName(i.approvedByName) || "—"}</td>
                <td className={`${td} text-amber-800`}>{firstName(i.reviewedByName) || "—"}</td>
                <td className={`${td} ${i.damageConfirmPending ? "italic text-amber-600" : "font-medium text-amber-900"}`}>{damageConfirmedLabel(i)}</td>
                <td className="px-3 py-2 text-xs">
                  <DisputeStatus item={i} token={token} />
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </>
  );
}
