import { notFound } from "next/navigation";
import type { Metadata } from "next";
import { prisma } from "@/lib/prisma";
import { getSupplierDebtPendingItems, getSupplierDebtDisputedItems, findSupplierByPublicLedgerToken } from "@/lib/supplierDebt";
import { SupplierShippingPhotoCapture } from "@/components/supplier-ledger/SupplierShippingPhotoCapture";
import { SupplierShipmentConfirmButton } from "@/components/supplier-ledger/SupplierShipmentConfirmButton";
import { SupplierShipmentHistoryTable } from "@/components/supplier-ledger/SupplierShipmentHistoryTable";

// Confirmado 2026-09-08 (Fase 1, proveedores con crédito): página pública,
// SIN auth() — el proveedor de crédito (hoy solo CHEN) accede solo con este
// enlace, sin usuario ni contraseña, y solo puede VER (nunca modificar
// nada). Pedido explícito del usuario: no debe verse ninguna marca de
// DAFLOW acá — el título de la pestaña se sobreescribe abajo, y esta página
// vive fuera de cualquier layout con navegación/branding de la app.
//
// Confirmado 2026-09-15: el layout raíz define `icons` dinámicamente
// (platformSettings.faviconUrl, el logo real de DAFLOW), y ese valor le
// gana a cualquier icon.svg de archivo puesto en esta carpeta — probado
// directo en el navegador. La única forma de taparlo es que ESTA página
// defina su propio `icons` en metadata (config le gana a config, sin
// importar el nivel), acá con un ícono transparente.
export const metadata: Metadata = {
  title: "Estado de cuenta",
  description: "Detalle de mercadería y pagos.",
  icons: {
    icon: "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=",
  },
};

function money(n: number) {
  return `$${n.toLocaleString("es-EC", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

const DATE_FMT = new Intl.DateTimeFormat("es-EC", {
  timeZone: "America/Guayaquil",
  weekday: "short",
  day: "2-digit",
  month: "short",
  year: "numeric",
});
const DATETIME_FMT = new Intl.DateTimeFormat("es-EC", { timeZone: "America/Guayaquil", day: "2-digit", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit" });

export default async function SupplierLedgerPage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  const supplier = await findSupplierByPublicLedgerToken(token);
  if (!supplier || supplier.paymentMode !== "CREDITO") notFound();

  const shipmentInclude = {
    catalogItem: { select: { name: true } },
    // Confirmado 2026-09-17, pedido explícito del usuario: además de
    // quién aprobó (Bryan, normalmente), mostrar quién solicitó la
    // compra — normalmente Jariel o Nairoby; en una emergencia (Bryan
    // solicita), el que aprueba pasa a ser el admin, nunca la misma
    // persona (ver isEmergency en schema.prisma). Un solo nombre por
    // columna.
    requestedBy: { select: { name: true } },
    reviewedBy: { select: { name: true } },
  } as const;

  const [pendingItems, disputedItems, closedPayments, pendingShipments, confirmedShipments] = await Promise.all([
    getSupplierDebtPendingItems(supplier.id),
    getSupplierDebtDisputedItems(supplier.id),
    prisma.supplierDebtPayment.findMany({
      where: { supplierId: supplier.id, closedAt: { not: null } },
      include: {
        requests: {
          include: {
            catalogItem: { select: { name: true } },
            reviewedBy: { select: { name: true } },
            receipt: { select: { approvedBy: { select: { name: true } } } },
          },
        },
        // Confirmado 2026-09-08: nunca se expone la cuenta de ORIGEN (la
        // nuestra) en esta vista pública — solo lo que le corresponde ver a
        // él (monto, fecha, y su propia cuenta de destino).
        transfers: { select: { amount: true, transferDate: true, accountDestino: true, comprobanteNumber: true } },
      },
      orderBy: { closedAt: "desc" },
    }),
    // Confirmado 2026-09-15, pedido explícito del usuario: pedidos que ya
    // aprobó Bryan pero que Inventario todavía no recibió (en cuanto se
    // recibe algo pasa a RECEIVED_PENDING_REVIEW, ya no tiene sentido
    // pedirle a CHEN una foto de "lo que está enviando").
    prisma.purchaseRequest.findMany({
      where: { supplierId: supplier.id, status: "APPROVED", supplierShippingConfirmedAt: null },
      include: shipmentInclude,
      orderBy: { requestedAt: "asc" },
    }),
    // Confirmado 2026-09-17, pedido explícito del usuario: una vez que el
    // equipo de despacho aprieta "Ya lo enviamos", el pedido sale de la
    // lista de arriba y pasa a este historial de solo lectura, en el mismo
    // enlace. Puramente informativo (como la foto): no reemplaza la
    // recepción real de Daniel.
    prisma.purchaseRequest.findMany({
      where: { supplierId: supplier.id, status: "APPROVED", supplierShippingConfirmedAt: { not: null } },
      include: shipmentInclude,
      orderBy: { supplierShippingConfirmedAt: "desc" },
    }),
  ]);

  const balance = pendingItems.reduce((s, i) => s + i.totalCost, 0);

  const th = "px-3 py-2 whitespace-nowrap";
  const td = "px-3 py-2 whitespace-nowrap";
  const NOMBRE_TH = "px-3 py-2 min-w-[200px]";

  return (
    <div className="min-h-screen bg-neutral-50 text-neutral-900">
      {/* Confirmado 2026-09-15, pedido explícito del usuario: usar todo el
          ancho de pantalla (tipo tabla operativa/hoja de cálculo), en vez de
          la tarjeta angosta y centrada de antes. */}
      <div className="mx-auto max-w-[1600px] px-4 py-10 sm:px-6">
        <header className="mb-8">
          <h1 className="text-xl font-semibold tracking-tight">Estado de cuenta</h1>
          <p className="mt-1 text-sm text-neutral-500">Actualizado en tiempo real. Esta página es de solo lectura.</p>
        </header>

        <section className="mb-8 rounded-xl border border-neutral-200 bg-white p-6 shadow-sm w-fit">
          <p className="text-sm text-neutral-500">Saldo actual a pagar</p>
          <p className="mt-1 text-3xl font-semibold tabular-nums">{money(balance)}</p>
        </section>

        <section className="mb-8">
          <h2 className="mb-3 text-sm font-medium text-neutral-700">Mercadería confirmada, pendiente de pago</h2>
          {pendingItems.length === 0 ? (
            <p className="text-sm text-neutral-400">No hay mercadería pendiente de pago por ahora.</p>
          ) : (
            <div className="overflow-x-auto rounded-xl border border-neutral-200 bg-white shadow-sm">
              <table className="w-full text-left text-sm">
                <thead className="border-b border-neutral-200 bg-neutral-50 text-xs uppercase tracking-wide text-neutral-500">
                  <tr>
                    <th className={th}>Fecha</th>
                    <th className={NOMBRE_TH}>Producto</th>
                    <th className={`${th} text-right`}>Cant.</th>
                    <th className={`${th} text-right`}>Precio unit.</th>
                    <th className={`${th} text-right`}>Total</th>
                    <th className={th}>Aprobado por</th>
                    <th className={th}>Revisado por</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-neutral-100">
                  {pendingItems.map((i) => (
                    <tr key={i.id}>
                      <td className={`${td} text-neutral-600`}>{DATE_FMT.format(i.requestedAt)}</td>
                      <td className="px-3 py-2">{i.productName}</td>
                      <td className={`${td} text-right tabular-nums`}>{i.quantity}</td>
                      <td className={`${td} text-right tabular-nums`}>{money(i.totalCost / i.quantity)}</td>
                      <td className={`${td} text-right tabular-nums`}>{money(i.totalCost)}</td>
                      <td className={`${td} text-neutral-600`}>{i.approvedByName ?? "—"}</td>
                      <td className={`${td} text-neutral-600`}>{i.reviewedByName ?? "—"}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </section>

        <section className="mb-8">
          <h2 className="mb-1 text-sm font-medium text-neutral-700">Pedidos que nos falta enviar</h2>
          <p className="mb-3 text-xs text-neutral-500">
            Subir una foto en tiempo real de lo que están enviando es opcional — solo un refuerzo, no hace falta para nada más.
          </p>
          {pendingShipments.length === 0 ? (
            <p className="text-sm text-neutral-400">No hay pedidos pendientes de envío por ahora.</p>
          ) : (
            <div className="overflow-x-auto rounded-xl border border-neutral-200 bg-white shadow-sm">
              <table className="w-full text-left text-sm">
                <thead className="border-b border-neutral-200 bg-neutral-50 text-xs uppercase tracking-wide text-neutral-500">
                  <tr>
                    <th className={th}>Fecha aprobado</th>
                    <th className={NOMBRE_TH}>Producto</th>
                    <th className={`${th} text-right`}>Cant.</th>
                    <th className={th}>Solicitado por</th>
                    <th className={th}>Aprobado por</th>
                    <th className={th}>Foto (opcional)</th>
                    <th className={th}>¿Ya lo enviaron?</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-neutral-100">
                  {pendingShipments.map((r) => (
                    <tr key={r.id}>
                      <td className={`${td} text-neutral-600`}>{DATE_FMT.format(r.reviewedAt ?? r.requestedAt)}</td>
                      <td className="px-3 py-2">{r.catalogItem.name}</td>
                      <td className={`${td} text-right tabular-nums`}>{r.quantity}</td>
                      <td className={`${td} text-neutral-600`}>{r.requestedBy?.name ?? "—"}</td>
                      <td className={`${td} text-neutral-600`}>{r.reviewedBy?.name ?? "—"}</td>
                      <td className="px-3 py-2">
                        <SupplierShippingPhotoCapture token={token} requestId={r.id} initialPhotoUrl={r.supplierShippingPhotoUrl} />
                      </td>
                      <td className="px-3 py-2">
                        <SupplierShipmentConfirmButton token={token} requestId={r.id} />
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </section>

        <section className="mb-8">
          <h2 className="mb-3 text-sm font-medium text-neutral-700">Historial de lo que ya confirmaron enviado</h2>
          <SupplierShipmentHistoryTable
            rows={confirmedShipments.map((r) => ({
              id: r.id,
              confirmedAt: (r.supplierShippingConfirmedAt ?? r.requestedAt).toISOString(),
              productName: r.catalogItem.name,
              quantity: r.quantity,
              requestedByName: r.requestedBy?.name ?? null,
              photoUrl: r.supplierShippingPhotoUrl,
            }))}
          />
        </section>

        {disputedItems.length > 0 && (
          <section className="mb-8">
            <h2 className="mb-3 text-sm font-medium text-neutral-700">
              Mercadería en revisión (incompleta, dañada o distinta) — no se incluye en el saldo hasta resolverse
            </h2>
            <div className="overflow-x-auto rounded-xl border border-amber-200 bg-amber-50 shadow-sm">
              <table className="w-full text-left text-sm">
                <thead className="border-b border-amber-200 text-xs uppercase tracking-wide text-amber-700">
                  <tr>
                    <th className={th}>Fecha</th>
                    <th className={NOMBRE_TH}>Producto</th>
                    <th className={`${th} text-right`}>Cant.</th>
                    <th className="px-3 py-2">Detalle</th>
                    <th className={`${th} text-right`}>Valor si se resuelve</th>
                    <th className={th}>Aprobado por</th>
                    <th className={th}>Revisado por</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-amber-100">
                  {disputedItems.map((i) => (
                    <tr key={i.id}>
                      <td className={`${td} text-amber-800`}>{DATE_FMT.format(i.requestedAt)}</td>
                      <td className="px-3 py-2 text-amber-900">{i.productName}</td>
                      <td className={`${td} text-right tabular-nums text-amber-800`}>{i.quantity}</td>
                      <td className="px-3 py-2 text-amber-800">
                        {[
                          i.damagedQty > 0 ? `${i.damagedQty} dañadas` : null,
                          i.incompleteQty > 0 ? `${i.incompleteQty} incompletas` : null,
                          i.differentQty > 0 ? `${i.differentQty} distintas` : null,
                        ]
                          .filter(Boolean)
                          .join(", ")}
                      </td>
                      <td className={`${td} text-right tabular-nums text-amber-800`}>{money(i.wouldBeValue)}</td>
                      <td className={`${td} text-amber-800`}>{i.approvedByName ?? "—"}</td>
                      <td className={`${td} text-amber-800`}>{i.reviewedByName ?? "—"}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </section>
        )}

        <section>
          <h2 className="mb-3 text-sm font-medium text-neutral-700">Historial de tandas pagadas</h2>
          {closedPayments.length === 0 ? (
            <p className="text-sm text-neutral-400">Todavía no hay tandas pagadas.</p>
          ) : (
            <div className="space-y-6">
              {closedPayments.map((p) => (
                <div key={p.id} className="rounded-xl border border-neutral-200 bg-white p-5 shadow-sm">
                  <div className="mb-3 flex items-baseline justify-between">
                    <span className="text-sm font-medium text-neutral-700">{p.code}</span>
                    <span className="text-sm tabular-nums text-neutral-500">{money(p.totalAmount)}</span>
                  </div>
                  <div className="mb-3 overflow-x-auto rounded-lg border border-neutral-100">
                    <table className="w-full text-left text-sm">
                      <thead className="border-b border-neutral-200 bg-neutral-50 text-xs uppercase tracking-wide text-neutral-500">
                        <tr>
                          <th className={NOMBRE_TH}>Producto</th>
                          <th className={`${th} text-right`}>Cant.</th>
                          <th className={`${th} text-right`}>Total</th>
                          <th className={th}>Aprobado por</th>
                          <th className={th}>Revisado por</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-neutral-100">
                        {p.requests.map((r) => (
                          <tr key={r.id}>
                            <td className="px-3 py-2">{r.catalogItem.name}</td>
                            <td className={`${td} text-right tabular-nums`}>{r.quantity}</td>
                            <td className={`${td} text-right tabular-nums`}>{money(r.totalCost)}</td>
                            <td className={`${td} text-neutral-600`}>{r.reviewedBy?.name ?? "—"}</td>
                            <td className={`${td} text-neutral-600`}>{r.receipt?.approvedBy?.name ?? "—"}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                  <div className="border-t border-neutral-100 pt-3">
                    <p className="mb-1 text-xs uppercase tracking-wide text-neutral-400">Transferencias</p>
                    <ul className="space-y-1 text-sm text-neutral-600">
                      {p.transfers.map((t, idx) => (
                        <li key={idx} className="flex justify-between">
                          <span>
                            {DATETIME_FMT.format(t.transferDate)} · comp. {t.comprobanteNumber}
                          </span>
                          <span className="tabular-nums">{money(t.amount)}</span>
                        </li>
                      ))}
                    </ul>
                  </div>
                </div>
              ))}
            </div>
          )}
        </section>
      </div>
    </div>
  );
}
