import { notFound } from "next/navigation";
import type { Metadata } from "next";
import { prisma } from "@/lib/prisma";
import { findSupplierByPublicShippingToken } from "@/lib/supplierDebt";
import { SupplierShippingPhotoCapture } from "@/components/supplier-ledger/SupplierShippingPhotoCapture";
import { SupplierShipmentConfirmButton } from "@/components/supplier-ledger/SupplierShipmentConfirmButton";
import { SupplierShipmentHistoryTable } from "@/components/supplier-ledger/SupplierShipmentHistoryTable";

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
    // Corregido 2026-09-17: antes exigía status "APPROVED" — así que si
    // Daniel recibía la mercadería ANTES de que el equipo de CHEN entrara a
    // apretar "Ya lo enviamos", el pedido desaparecía de esta lista sin que
    // ellos nunca pudieran confirmarlo. Esta lista es el propio pendiente
    // de CHEN, no debe depender de nuestra operación interna — ahora solo
    // exige que Bryan ya haya aprobado (status distinto de
    // PENDING_APPROVAL/REJECTED) y que ellos no lo hayan confirmado todavía.
    prisma.purchaseRequest.findMany({
      where: {
        supplierId: supplier.id,
        status: { notIn: ["PENDING_APPROVAL", "REJECTED"] },
        supplierShippingConfirmedAt: null,
      },
      include,
      orderBy: { requestedAt: "asc" },
    }),
    // Confirmado 2026-09-17, pedido explícito del usuario: una vez que el
    // equipo de despacho aprieta "Ya lo enviamos", el pedido pasa acá — un
    // historial de solo lectura de lo que ELLOS MISMOS ya confirmaron que
    // despacharon. A PROPÓSITO sin filtro de status — este historial es el
    // registro propio de CHEN, nunca debe depender de nuestra operación
    // interna (INVESTOCK/recepción de Daniel). Corregido 2026-09-17: antes
    // exigía status "APPROVED", así que en cuanto Daniel recibía la
    // mercadería (proceso nuestro, no de ellos) el pedido desaparecía de
    // acá aunque Chen sí lo hubiera confirmado.
    prisma.purchaseRequest.findMany({
      where: { supplierId: supplier.id, supplierShippingConfirmedAt: { not: null } },
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

        <section>
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
      </div>
    </div>
  );
}
