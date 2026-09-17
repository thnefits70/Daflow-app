import { notFound } from "next/navigation";
import type { Metadata } from "next";
import { prisma } from "@/lib/prisma";
import { findSupplierByPublicShippingToken } from "@/lib/supplierDebt";
import { SupplierShippingPhotoCapture } from "@/components/supplier-ledger/SupplierShippingPhotoCapture";
import { SupplierShipmentConfirmButton } from "@/components/supplier-ledger/SupplierShipmentConfirmButton";

// Confirmado 2026-09-17, pedido explícito del usuario: segundo enlace,
// llave completamente aparte de /proveedor-ledger/[token] (el del saldo) —
// pensado para que el proveedor de crédito (hoy solo CHEN) se lo pase a SU
// PROPIO equipo de despacho. Muestra ÚNICAMENTE los pedidos que faltan
// enviar (producto/cantidad) — nunca el saldo, nunca la plata que se le
// debe. Valida solo publicShippingToken (findSupplierByPublicShippingToken)
// — aunque alguien edite esta URL, esta llave nunca abre la página del
// saldo, porque esa valida un campo distinto (publicLedgerToken).
export const metadata: Metadata = {
  title: "Pedidos por enviar",
  description: "Lista de pedidos pendientes de envío.",
  icons: {
    icon: "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=",
  },
};

const DATE_FMT = new Intl.DateTimeFormat("es-EC", {
  timeZone: "America/Guayaquil",
  weekday: "short",
  day: "2-digit",
  month: "short",
  year: "numeric",
});
const DATETIME_FMT = new Intl.DateTimeFormat("es-EC", {
  timeZone: "America/Guayaquil",
  weekday: "short",
  day: "2-digit",
  month: "short",
  year: "numeric",
  hour: "2-digit",
  minute: "2-digit",
});

export default async function SupplierShippingLedgerPage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  const supplier = await findSupplierByPublicShippingToken(token);
  if (!supplier || supplier.paymentMode !== "CREDITO") notFound();

  const include = {
    catalogItem: { select: { name: true } },
    // Confirmado 2026-09-17, pedido explícito del usuario: además de quién
    // aprobó (Bryan, normalmente), mostrar quién solicitó la compra —
    // normalmente Jariel o Nairoby; en una emergencia (Bryan solicita), el
    // que aprueba pasa a ser el admin, nunca la misma persona (ver
    // isEmergency en schema.prisma). Un solo nombre en cada columna.
    requestedBy: { select: { name: true } },
    reviewedBy: { select: { name: true } },
  } as const;

  const [pendingShipments, confirmedShipments] = await Promise.all([
    prisma.purchaseRequest.findMany({
      where: { supplierId: supplier.id, status: "APPROVED", supplierShippingConfirmedAt: null },
      include,
      orderBy: { requestedAt: "asc" },
    }),
    // Confirmado 2026-09-17, pedido explícito del usuario: una vez que el
    // equipo de despacho aprieta "Ya lo enviamos", el pedido sale de la
    // lista de arriba y pasa acá — un historial de solo lectura de lo que
    // ELLOS MISMOS ya confirmaron que despacharon, en el mismo enlace.
    // Puramente informativo (como la foto): no reemplaza la recepción real
    // de Daniel. Si Daniel ya recibió el pedido, sale de "APPROVED" y
    // desaparece de acá también (pasa a la otra pantalla, la del saldo).
    prisma.purchaseRequest.findMany({
      where: { supplierId: supplier.id, status: "APPROVED", supplierShippingConfirmedAt: { not: null } },
      include,
      orderBy: { supplierShippingConfirmedAt: "desc" },
    }),
  ]);

  const th = "px-3 py-2 whitespace-nowrap";
  const td = "px-3 py-2 whitespace-nowrap";
  const NOMBRE_TH = "px-3 py-2 min-w-[200px]";

  return (
    <div className="min-h-screen bg-neutral-50 text-neutral-900">
      <div className="mx-auto max-w-[1600px] px-4 py-10 sm:px-6">
        <header className="mb-8">
          <h1 className="text-xl font-semibold tracking-tight">Pedidos por enviar</h1>
          <p className="mt-1 text-sm text-neutral-500">Actualizado en tiempo real. Esta página es de solo lectura.</p>
        </header>

        <section className="mb-8">
          <p className="mb-3 text-xs text-neutral-500">
            Subir una foto en tiempo real de lo que están enviando es opcional — solo un refuerzo, no hace falta para nada más. Cuando
            despachen un pedido, aprieten "Ya lo enviamos" (con foto o sin ella) para pasarlo al historial de abajo.
          </p>
          {pendingShipments.length === 0 ? (
            <p className="text-sm text-neutral-400">No hay pedidos pendientes de envío por ahora.</p>
          ) : (
            <div className="overflow-x-auto rounded-xl border border-neutral-200 bg-white shadow-sm">
              <table className="w-full text-left text-sm">
                <thead className="border-b border-neutral-200 bg-neutral-50 text-xs uppercase tracking-wide text-neutral-500">
                  <tr>
                    <th className={th}>Fecha</th>
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
                      <td className={`${td} text-neutral-600`}>{DATE_FMT.format(r.requestedAt)}</td>
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

        <section>
          <h2 className="mb-3 text-sm font-medium text-neutral-700">Historial de lo que ya confirmaron enviado</h2>
          {confirmedShipments.length === 0 ? (
            <p className="text-sm text-neutral-400">Todavía no han confirmado ningún envío.</p>
          ) : (
            <div className="overflow-x-auto rounded-xl border border-neutral-200 bg-white shadow-sm">
              <table className="w-full text-left text-sm">
                <thead className="border-b border-neutral-200 bg-neutral-50 text-xs uppercase tracking-wide text-neutral-500">
                  <tr>
                    <th className={th}>Confirmado</th>
                    <th className={NOMBRE_TH}>Producto</th>
                    <th className={`${th} text-right`}>Cant.</th>
                    <th className={th}>Solicitado por</th>
                    <th className={th}>Foto</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-neutral-100">
                  {confirmedShipments.map((r) => (
                    <tr key={r.id}>
                      <td className={`${td} text-neutral-600`}>{r.supplierShippingConfirmedAt ? DATETIME_FMT.format(r.supplierShippingConfirmedAt) : "—"}</td>
                      <td className="px-3 py-2">{r.catalogItem.name}</td>
                      <td className={`${td} text-right tabular-nums`}>{r.quantity}</td>
                      <td className={`${td} text-neutral-600`}>{r.requestedBy?.name ?? "—"}</td>
                      <td className="px-3 py-2">
                        {r.supplierShippingPhotoUrl ? (
                          // eslint-disable-next-line @next/next/no-img-element
                          <img src={r.supplierShippingPhotoUrl} alt="Foto enviada" className="w-16 h-16 object-cover rounded-md border border-neutral-200" />
                        ) : (
                          <span className="text-neutral-400">—</span>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </section>
      </div>
    </div>
  );
}
