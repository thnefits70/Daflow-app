import { notFound } from "next/navigation";
import type { Metadata } from "next";
import { prisma } from "@/lib/prisma";
import {
  getSupplierDebtDisputedItems,
  getSupplierReplacementHistory,
  getSupplierDebtPendingItems,
  getSupplierDebtPendingExcessItems,
  findSupplierByPublicLedgerToken,
  SUPPLIER_PUBLIC_LINK_START,
  supplierDebtReportsInclude,
  appliedTandaCreditDeduction,
} from "@/lib/supplierDebt";
import { formatPurchaseRequestCode } from "@/lib/purchases";
import { SupplierPendingShipmentsList, ProductThumb } from "@/components/supplier-ledger/SupplierPendingShipmentsList";
import { SupplierShipmentHistoryTable } from "@/components/supplier-ledger/SupplierShipmentHistoryTable";
import { SupplierDisputedItemsTable } from "@/components/supplier-ledger/SupplierDisputedItemsTable";
import { SupplierReplacementHistoryTable } from "@/components/supplier-ledger/SupplierReplacementHistoryTable";
import { firstName } from "@/lib/actorName";

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
  title: "IMPORTADORA CHEN",
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
  hour: "2-digit",
  minute: "2-digit",
});
const SHORT_DATE_FMT = new Intl.DateTimeFormat("es-EC", { timeZone: "America/Guayaquil", weekday: "short", day: "2-digit", month: "short" });
const DATETIME_FMT = new Intl.DateTimeFormat("es-EC", { timeZone: "America/Guayaquil", day: "2-digit", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit" });

export default async function SupplierLedgerPage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  const supplier = await findSupplierByPublicLedgerToken(token);
  if (!supplier || supplier.paymentMode !== "CREDITO") notFound();

  const shipmentInclude = {
    // Confirmado 2026-09-17, pedido explícito del usuario: mostrarle a
    // Chen una foto del producto — la ÚLTIMA que se subió al matricularlo
    // (PurchaseCatalogItem.photos, orden de subida), sin ningún texto ni
    // marca nuestra encima, la imagen tal cual.
    catalogItem: { select: { name: true, photos: true } },
    // Confirmado 2026-09-17, pedido explícito del usuario: además de
    // quién aprobó (Bryan, normalmente), mostrar quién solicitó la
    // compra — normalmente Jariel o Nairoby; en una emergencia (Bryan
    // solicita), el que aprueba pasa a ser el admin, nunca la misma
    // persona (ver isEmergency en schema.prisma). Un solo nombre por
    // columna.
    requestedBy: { select: { name: true } },
    reviewedBy: { select: { name: true } },
  } as const;

  // Confirmado 2026-09-22, pedido explícito del usuario: CHEN solo ve
  // solicitudes hechas desde SUPPLIER_PUBLIC_LINK_START (21-sep-2026) — en
  // TODAS las secciones, incluidas las tandas pagadas (se oculta cualquier
  // tanda que incluya algo anterior). El panel interno sigue viendo todo.
  const since = SUPPLIER_PUBLIC_LINK_START;
  const [allDisputedItems, allPendingDebtItems, allPendingExcessItems, closedPayments, pendingShipments, confirmedShipments, replacementHistory] = await Promise.all([
    getSupplierDebtDisputedItems(supplier.id),
    // Confirmado 2026-09-17, pedido explícito del usuario: mostrarle a CHEN
    // lo que Inventario ya recibió y confirmó (cargado al Kardex de
    // INVESTOCK con la supervisión de Daniel) y que todavía no entra en
    // ninguna tanda pagada — es justo lo que les debemos ahora mismo, para
    // que sepan qué mercadería sí llegó y qué nos falta pagarles por ella.
    getSupplierDebtPendingItems(supplier.id),
    // Confirmado 2026-09-21, pedido explícito del usuario: el excedente
    // (llegó más de lo pedido) que Bryan ya confirmó real también se le
    // debe a Chen — se le muestra anclado a la solicitud que lo originó,
    // nunca como una compra aparte.
    getSupplierDebtPendingExcessItems(supplier.id),
    prisma.supplierDebtPayment.findMany({
      where: {
        supplierId: supplier.id,
        closedAt: { not: null },
        requests: { none: { requestedAt: { lt: since } } },
        excessReports: { none: { request: { requestedAt: { lt: since } } } },
      },
      include: {
        requests: {
          include: {
            ...supplierDebtReportsInclude,
            catalogItem: { select: { name: true } },
            reviewedBy: { select: { name: true } },
            receipt: { select: { approvedBy: { select: { name: true } } } },
          },
        },
        excessReports: { include: { request: { select: { requestNumber: true, unitCost: true, catalogItem: { select: { name: true } } } } } },
        // Confirmado 2026-09-08: nunca se expone la cuenta de ORIGEN (la
        // nuestra) en esta vista pública — solo lo que le corresponde ver a
        // él (monto, fecha, y su propia cuenta de destino).
        transfers: { select: { amount: true, transferDate: true, accountDestino: true, comprobanteNumber: true } },
      },
      orderBy: { closedAt: "desc" },
    }),
    // Confirmado 2026-09-15, pedido explícito del usuario: pedidos que ya
    // aprobó Bryan y que CHEN todavía no ha confirmado que envió. Corregido
    // 2026-09-17: antes exigía status "APPROVED" — así que si Daniel
    // recibía la mercadería ANTES de que el equipo de CHEN entrara a
    // apretar "Ya lo enviamos", el pedido desaparecía de esta lista sin que
    // ellos nunca pudieran confirmarlo (se quedaba invisible para siempre,
    // ni acá ni en el historial). Esta lista es el propio pendiente de
    // CHEN, no debe depender de nuestra operación interna — ahora solo
    // exige que Bryan ya haya aprobado (status distinto de
    // PENDING_APPROVAL/REJECTED) y que ellos no lo hayan confirmado todavía.
    prisma.purchaseRequest.findMany({
      where: {
        supplierId: supplier.id,
        status: { notIn: ["PENDING_APPROVAL", "REJECTED"] },
        supplierShippingConfirmedAt: null,
        requestedAt: { gte: since },
      },
      include: shipmentInclude,
      orderBy: { requestedAt: "asc" },
    }),
    // Confirmado 2026-09-17, pedido explícito del usuario: una vez que el
    // equipo de despacho aprieta "Ya lo enviamos", el pedido pasa a este
    // historial de solo lectura, en el mismo enlace. A PROPÓSITO sin filtro
    // de status — esta sección es el registro propio de CHEN de lo que
    // ELLOS confirmaron, y nunca debe depender de nuestra operación interna
    // (INVESTOCK/recepción de Daniel). Corregido 2026-09-17: antes exigía
    // status "APPROVED", así que en cuanto Daniel recibía la mercadería
    // (proceso nuestro, no de ellos) el pedido desaparecía de acá aunque
    // Chen sí lo hubiera confirmado — quedaba mezclado con nuestro estado
    // interno cuando no debía. Ahora solo depende de
    // supplierShippingConfirmedAt, sin importar en qué status esté el
    // pedido para nosotros.
    prisma.purchaseRequest.findMany({
      where: { supplierId: supplier.id, supplierShippingConfirmedAt: { not: null }, requestedAt: { gte: since } },
      include: shipmentInclude,
      orderBy: { supplierShippingConfirmedAt: "desc" },
    }),
    getSupplierReplacementHistory(supplier.id),
  ]);

  const disputedItems = allDisputedItems.filter((i) => i.requestedAt >= since);
  const pendingDebtItems = allPendingDebtItems.filter((i) => i.requestedAt >= since);
  const pendingExcessItems = allPendingExcessItems.filter((i) => i.requestedAt >= since);

  const th = "px-3 py-2 whitespace-nowrap";
  const td = "px-3 py-2 whitespace-nowrap";
  const NOMBRE_TH = "px-3 py-2 min-w-[200px]";

  // Confirmado 2026-09-22, pedido explícito del usuario: se veía bien solo en
  // computadora — ahora cada sección, en celular, pasa de tabla ancha a
  // tarjetas compactas (md:hidden / hidden md:block), y arriba hay un
  // resumen rápido de cuánto falta enviar y cuántos productos están
  // recibidos sin pagar. Corregido 2026-09-22: el rediseño había vuelto a
  // mostrar la SUMA en $ (arriba y como fila "Total") — eso contradice lo
  // confirmado el 2026-09-17 (931a3bf, 4fb1427): a CHEN nunca se le muestra
  // un total de deuda fuera de una tanda ya cerrada. Solo el costo por
  // producto y el conteo, nada que lo sume.
  const pendingReceivedCount = pendingDebtItems.length + pendingExcessItems.length;

  return (
    <div className="min-h-screen bg-neutral-50 text-neutral-900">
      {/* Confirmado 2026-09-15, pedido explícito del usuario: usar todo el
          ancho de pantalla (tipo tabla operativa/hoja de cálculo), en vez de
          la tarjeta angosta y centrada de antes. */}
      <div className="mx-auto max-w-[1600px] px-3 py-5 sm:px-6 sm:py-10">
        <header className="mb-4 sm:mb-6">
          <h1 className="text-xl font-semibold tracking-tight">IMPORTADORA CHEN</h1>
          <p className="mt-1 text-sm text-neutral-500">Actualizado en tiempo real. Esta página es de solo lectura.</p>
        </header>

        <div className="mb-6 grid grid-cols-2 gap-2 sm:mb-8 sm:flex sm:gap-3">
          <SummaryTile label="Falta enviar" value={`${pendingShipments.length}`} hint={pendingShipments.length === 1 ? "pedido" : "pedidos"} href="#por-enviar" />
          <SummaryTile label="Recibido, pendiente de pago" value={`${pendingReceivedCount}`} hint={pendingReceivedCount === 1 ? "producto" : "productos"} href="#recibido" />
          {disputedItems.length > 0 && (
            <SummaryTile label="En revisión" value={`${disputedItems.length}`} hint={disputedItems.length === 1 ? "producto" : "productos"} href="#revision" tone="amber" />
          )}
        </div>

        <section id="por-enviar" className="mb-8 scroll-mt-4">
          <SectionTitle count={pendingShipments.length}>Pedidos que faltan enviar a la bodega TBS</SectionTitle>
          <p className="mb-3 text-xs text-neutral-500">
            Subir una foto en tiempo real de lo que están enviando es opcional — solo un refuerzo, no hace falta para nada más.
          </p>
          <SupplierPendingShipmentsList
            token={token}
            rows={pendingShipments.map((r) => ({
              id: r.id,
              approvedAt: r.reviewedAt ?? r.requestedAt,
              productName: r.catalogItem.name,
              productImageUrl: r.catalogItem.photos.at(-1) ?? null,
              quantity: r.quantity,
              requestedByName: firstName(r.requestedBy?.name) || null,
              approvedByName: firstName(r.reviewedBy?.name) || null,
              photoUrl: r.supplierShippingPhotoUrl,
            }))}
          />
        </section>

        <section className="mb-8">
          <SectionTitle count={confirmedShipments.length}>Historial de lo que ya se despachó a la bodega TBS</SectionTitle>
          <SupplierShipmentHistoryTable
            rows={confirmedShipments.map((r) => ({
              id: r.id,
              confirmedAt: (r.supplierShippingConfirmedAt ?? r.requestedAt).toISOString(),
              productName: r.catalogItem.name,
              productImageUrl: r.catalogItem.photos.at(-1) ?? null,
              quantity: r.quantity,
              requestedByName: firstName(r.requestedBy?.name) || null,
              photoUrl: r.supplierShippingPhotoUrl,
            }))}
          />
        </section>

        <section id="recibido" className="mb-8 scroll-mt-4">
          <SectionTitle count={pendingReceivedCount}>Mercadería que ya la bodega TBS confirmó que sí recibió</SectionTitle>
          <p className="mb-3 text-xs text-neutral-500">
            Ya quedó registrada en nuestro sistema de inventario de la bodega de TBS, confirmada por el equipo de bodega de TBS — todavía no
            incluida en ninguna tanda pagada. Pendiente de pagar a CHEN, estos pagos los realiza Andrés.
          </p>
          {pendingReceivedCount === 0 ? (
            <EmptyBox>No hay mercadería recibida pendiente de pago por ahora.</EmptyBox>
          ) : (
            <>
              {/* Celular */}
              <div className="overflow-hidden rounded-xl border border-neutral-200 bg-white shadow-sm md:hidden">
                <ul className="divide-y divide-neutral-100">
                  {pendingDebtItems.map((i) => (
                    <li key={i.id} className="flex gap-3 p-3">
                      <ProductThumb url={i.productImageUrl} alt={i.productName} size="sm" />
                      <div className="min-w-0 flex-1">
                        <div className="flex items-start justify-between gap-2">
                          <p className="text-sm font-medium leading-snug">{i.productName}</p>
                          <span className="shrink-0 text-sm font-semibold tabular-nums">{money(i.totalCost)}</span>
                        </div>
                        <p className="mt-0.5 text-xs text-neutral-500">
                          {i.quantity} uds · {SHORT_DATE_FMT.format(i.receivedAt ?? i.requestedAt)}
                        </p>
                        {i.creditDeduction > 0 && <p className="text-xs text-amber-700">{discountNote(i)}</p>}
                        <p className="text-xs text-neutral-500">
                          Aprobó {firstName(i.approvedByName) || "—"} · Confirmó {firstName(i.reviewedByName) || "—"}
                        </p>
                      </div>
                    </li>
                  ))}
                  {pendingExcessItems.map((i) => (
                    <li key={`excess-${i.id}`} className="flex gap-3 bg-amber-50/60 p-3">
                      <ProductThumb url={i.productImageUrl} alt={i.productName} size="sm" />
                      <div className="min-w-0 flex-1">
                        <div className="flex items-start justify-between gap-2">
                          <p className="text-sm font-medium leading-snug">{i.productName}</p>
                          <span className="shrink-0 text-sm font-semibold tabular-nums">{money(i.amount)}</span>
                        </div>
                        <p className="mt-0.5 text-xs text-amber-700">
                          Excedente, {i.requestNumber != null ? formatPurchaseRequestCode(i.requestNumber) : "—"}
                        </p>
                        <p className="text-xs text-neutral-500">
                          {i.excessQty} uds · {i.excessConfirmedAt ? SHORT_DATE_FMT.format(i.excessConfirmedAt) : "—"} · Confirmó{" "}
                          {firstName(i.excessConfirmedByName) || "—"}
                        </p>
                      </div>
                    </li>
                  ))}
                </ul>
              </div>

              {/* Computadora */}
              <div className="hidden overflow-x-auto rounded-xl border border-neutral-200 bg-white shadow-sm md:block">
                <table className="w-full text-left text-sm">
                  <thead className="border-b border-neutral-200 bg-neutral-50 text-xs uppercase tracking-wide text-neutral-500">
                    <tr>
                      <th className={th}>Fecha recibido</th>
                      <th className={th}>Imagen</th>
                      <th className={NOMBRE_TH}>Producto</th>
                      <th className={`${th} text-right`}>Cant.</th>
                      <th className={`${th} text-right`}>Costo</th>
                      <th className={th}>Aprobado por</th>
                      <th className={th}>Confirmado por</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-neutral-100">
                    {pendingDebtItems.map((i) => (
                      <tr key={i.id}>
                        <td className={`${td} text-neutral-600`}>{DATE_FMT.format(i.receivedAt ?? i.requestedAt)}</td>
                        <td className="px-3 py-2">
                          <ProductThumb url={i.productImageUrl} alt={i.productName} size="sm" />
                        </td>
                        <td className="px-3 py-2">
                          {i.productName}
                          {i.creditDeduction > 0 && <span className="block text-xs text-amber-700">{discountNote(i)}</span>}
                        </td>
                        <td className={`${td} text-right tabular-nums`}>{i.quantity}</td>
                        <td className={`${td} text-right tabular-nums`}>{money(i.totalCost)}</td>
                        <td className={`${td} text-neutral-600`}>{firstName(i.approvedByName) || "—"}</td>
                        <td className={`${td} text-neutral-600`}>{firstName(i.reviewedByName) || "—"}</td>
                      </tr>
                    ))}
                    {/* Confirmado 2026-09-21, pedido explícito del usuario:
                        excedente (llegó más de lo pedido) ya confirmado —
                        anclado a la solicitud que lo originó, mismo costo
                        unitario, nunca una compra aparte. */}
                    {pendingExcessItems.map((i) => (
                      <tr key={`excess-${i.id}`} className="bg-amber-50/50">
                        <td className={`${td} text-neutral-600`}>{i.excessConfirmedAt ? DATE_FMT.format(i.excessConfirmedAt) : "—"}</td>
                        <td className="px-3 py-2">
                          <ProductThumb url={i.productImageUrl} alt={i.productName} size="sm" />
                        </td>
                        <td className="px-3 py-2">
                          {i.productName} <span className="text-neutral-500">(excedente, {i.requestNumber != null ? formatPurchaseRequestCode(i.requestNumber) : "—"})</span>
                        </td>
                        <td className={`${td} text-right tabular-nums`}>{i.excessQty}</td>
                        <td className={`${td} text-right tabular-nums`}>{money(i.amount)}</td>
                        <td className={`${td} text-neutral-600`}>—</td>
                        <td className={`${td} text-neutral-600`}>{firstName(i.excessConfirmedByName) || "—"}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </>
          )}
        </section>

        {disputedItems.length > 0 && (
          <section id="revision" className="mb-8 scroll-mt-4">
            <SectionTitle count={disputedItems.length}>
              Mercadería en revisión (incompleta, dañada o distinta)
            </SectionTitle>
            {/* Confirmado 2026-09-22, pedido explícito del usuario: solo se paga
                lo que llegó completo y en buen estado — un pedido con algo mal se
                retiene ENTERO hasta que CHEN lo reponga (o acepte descontarlo). */}
            <p className="mb-3 text-xs text-neutral-500">
              Estos pedidos llegaron incompletos, dañados o distintos a lo pedido. Solo pagamos la mercadería que llega completa y en buen
              estado: el pago de cada uno de estos pedidos queda pendiente hasta que CHEN envíe el reemplazo de lo que llegó mal y la
              bodega TBS lo confirme.
            </p>
            <SupplierDisputedItemsTable items={disputedItems} showValue={false} token={token} />
          </section>
        )}

        <section className="mb-8">
          <SectionTitle count={replacementHistory.length}>Historial de faltantes y cambios ya repuestos</SectionTitle>
          <p className="mb-3 text-xs text-neutral-500">Lo que ustedes repusieron y la bodega TBS ya recibió y aprobó.</p>
          <SupplierReplacementHistoryTable items={replacementHistory} />
        </section>

        <section>
          <SectionTitle count={closedPayments.length}>Historial de tandas pagadas</SectionTitle>
          {closedPayments.length === 0 ? (
            <EmptyBox>Todavía no hay tandas pagadas.</EmptyBox>
          ) : (
            <div className="space-y-4 sm:space-y-6">
              {closedPayments
                .map((tanda) => ({
                  ...tanda,
                  requests: tanda.requests.map((r) => {
                    const creditDeduction = appliedTandaCreditDeduction(r.urgentReports, tanda.id);
                    return { ...r, creditDeduction, totalCost: Math.round((r.totalCost - creditDeduction) * 100) / 100 };
                  }),
                }))
                .map((p) => (
                <div key={p.id} className="rounded-xl border border-neutral-200 bg-white p-3 shadow-sm sm:p-5">
                  <div className="mb-3 flex items-baseline justify-between gap-2">
                    <span className="text-sm font-semibold text-neutral-800">{p.code}</span>
                    <span className="text-base font-semibold tabular-nums text-neutral-900">{money(p.totalAmount)}</span>
                  </div>
                  {/* Celular */}
                  <ul className="mb-3 divide-y divide-neutral-100 rounded-lg border border-neutral-100 md:hidden">
                    {p.requests.map((r) => (
                      <li key={r.id} className="px-3 py-2">
                        <div className="flex items-start justify-between gap-2 text-sm">
                          <span className="leading-snug">{r.catalogItem.name}</span>
                          <span className="shrink-0 tabular-nums">{money(r.totalCost)}</span>
                        </div>
                        <p className="text-xs text-neutral-500">
                          {r.quantity} uds · Aprobó {firstName(r.reviewedBy?.name) || "—"} · Revisó {firstName(r.receipt?.approvedBy?.name) || "—"}
                        </p>
                        {r.creditDeduction > 0 && <p className="text-xs text-amber-700">Con descuento de {money(r.creditDeduction)} por mercadería dañada</p>}
                      </li>
                    ))}
                    {p.excessReports.map((r) => (
                      <li key={`excess-${r.id}`} className="px-3 py-2">
                        <div className="flex items-start justify-between gap-2 text-sm">
                          <span className="leading-snug">{r.request.catalogItem.name}</span>
                          <span className="shrink-0 tabular-nums">{money(Math.round(r.request.unitCost * r.excessQty * 100) / 100)}</span>
                        </div>
                        <p className="text-xs text-neutral-500">
                          {r.excessQty} uds · excedente, {r.request.requestNumber != null ? formatPurchaseRequestCode(r.request.requestNumber) : "—"}
                        </p>
                      </li>
                    ))}
                  </ul>
                  {/* Computadora */}
                  <div className="mb-3 hidden overflow-x-auto rounded-lg border border-neutral-100 md:block">
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
                            <td className="px-3 py-2">
                              {r.catalogItem.name}
                              {r.creditDeduction > 0 && <span className="block text-xs text-amber-700">Con descuento de {money(r.creditDeduction)} por mercadería dañada</span>}
                            </td>
                            <td className={`${td} text-right tabular-nums`}>{r.quantity}</td>
                            <td className={`${td} text-right tabular-nums`}>{money(r.totalCost)}</td>
                            <td className={`${td} text-neutral-600`}>{firstName(r.reviewedBy?.name) || "—"}</td>
                            <td className={`${td} text-neutral-600`}>{firstName(r.receipt?.approvedBy?.name) || "—"}</td>
                          </tr>
                        ))}
                        {p.excessReports.map((r) => (
                          <tr key={`excess-${r.id}`}>
                            <td className="px-3 py-2">
                              {r.request.catalogItem.name} <span className="text-neutral-500">(excedente, {r.request.requestNumber != null ? formatPurchaseRequestCode(r.request.requestNumber) : "—"})</span>
                            </td>
                            <td className={`${td} text-right tabular-nums`}>{r.excessQty}</td>
                            <td className={`${td} text-right tabular-nums`}>{money(Math.round(r.request.unitCost * r.excessQty * 100) / 100)}</td>
                            <td className={`${td} text-neutral-600`}>—</td>
                            <td className={`${td} text-neutral-600`}>—</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                  <div className="border-t border-neutral-100 pt-3">
                    <p className="mb-1 text-xs uppercase tracking-wide text-neutral-400">Transferencias</p>
                    <ul className="space-y-1 text-sm text-neutral-600">
                      {p.transfers.map((t, idx) => (
                        <li key={idx} className="flex justify-between gap-3">
                          <span className="min-w-0">
                            {DATETIME_FMT.format(t.transferDate)} · comp. {t.comprobanteNumber}
                          </span>
                          <span className="shrink-0 tabular-nums">{money(t.amount)}</span>
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

function discountNote(i: { grossCost: number; creditDeduction: number }) {
  return `Valor del pedido ${money(i.grossCost)} menos ${money(i.creditDeduction)} de descuento por mercadería dañada`;
}

function SectionTitle({ children, count }: { children: React.ReactNode; count: number }) {
  return (
    <div className="mb-1.5 flex items-start gap-2">
      <h2 className="text-sm font-medium leading-snug text-neutral-800">{children}</h2>
      <span className="mt-px shrink-0 rounded-full bg-neutral-200 px-2 py-0.5 text-xs font-medium tabular-nums text-neutral-700">{count}</span>
    </div>
  );
}

function EmptyBox({ children }: { children: React.ReactNode }) {
  return <p className="rounded-xl border border-dashed border-neutral-300 bg-white px-4 py-6 text-center text-sm text-neutral-400">{children}</p>;
}

function SummaryTile({ label, value, hint, href, tone }: { label: string; value: string; hint: string; href: string; tone?: "amber" }) {
  const box = tone === "amber" ? "border-amber-200 bg-amber-50" : "border-neutral-200 bg-white";
  return (
    <a href={href} className={`block rounded-xl border px-3 py-2.5 shadow-sm sm:min-w-[200px] sm:px-4 sm:py-3 ${box}`}>
      <p className="text-[11px] uppercase tracking-wide text-neutral-500">{label}</p>
      <p className="mt-0.5 text-lg font-semibold tabular-nums leading-tight text-neutral-900">{value}</p>
      <p className="text-xs text-neutral-500">{hint}</p>
    </a>
  );
}
