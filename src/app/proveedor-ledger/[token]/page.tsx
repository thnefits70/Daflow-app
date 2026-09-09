import crypto from "crypto";
import { notFound } from "next/navigation";
import type { Metadata } from "next";
import { prisma } from "@/lib/prisma";
import { getSupplierDebtPendingItems, getSupplierDebtDisputedItems } from "@/lib/supplierDebt";

// Confirmado 2026-09-08 (Fase 1, proveedores con crédito): página pública,
// SIN auth() — el proveedor de crédito (hoy solo CHEN) accede solo con este
// enlace, sin usuario ni contraseña, y solo puede VER (nunca modificar
// nada). Pedido explícito del usuario: no debe verse ninguna marca de
// DAFLOW acá — el título de la pestaña se sobreescribe abajo, y esta página
// vive fuera de cualquier layout con navegación/branding de la app.
export const metadata: Metadata = {
  title: "Estado de cuenta",
  description: "Detalle de mercadería y pagos.",
};

function money(n: number) {
  return `$${n.toLocaleString("es-EC", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

const DATE_FMT = new Intl.DateTimeFormat("es-EC", { timeZone: "America/Guayaquil", day: "2-digit", month: "short", year: "numeric" });
const DATETIME_FMT = new Intl.DateTimeFormat("es-EC", { timeZone: "America/Guayaquil", day: "2-digit", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit" });

export default async function SupplierLedgerPage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  const tokenHash = crypto.createHash("sha256").update(token).digest("hex");

  const supplier = await prisma.supplier.findUnique({ where: { publicLedgerTokenHash: tokenHash } });
  if (!supplier || supplier.paymentMode !== "CREDITO") notFound();

  const [pendingItems, disputedItems, closedPayments] = await Promise.all([
    getSupplierDebtPendingItems(supplier.id),
    getSupplierDebtDisputedItems(supplier.id),
    prisma.supplierDebtPayment.findMany({
      where: { supplierId: supplier.id, closedAt: { not: null } },
      include: {
        requests: { include: { catalogItem: { select: { name: true } } } },
        // Confirmado 2026-09-08: nunca se expone la cuenta de ORIGEN (la
        // nuestra) en esta vista pública — solo lo que le corresponde ver a
        // él (monto, fecha, y su propia cuenta de destino).
        transfers: { select: { amount: true, transferDate: true, accountDestino: true, comprobanteNumber: true } },
      },
      orderBy: { closedAt: "desc" },
    }),
  ]);

  const balance = pendingItems.reduce((s, i) => s + i.totalCost, 0);

  return (
    <div className="min-h-screen bg-neutral-50 text-neutral-900">
      <div className="mx-auto max-w-3xl px-4 py-10 sm:px-6">
        <header className="mb-8">
          <h1 className="text-xl font-semibold tracking-tight">Estado de cuenta</h1>
          <p className="mt-1 text-sm text-neutral-500">Actualizado en tiempo real. Esta página es de solo lectura.</p>
        </header>

        <section className="mb-8 rounded-xl border border-neutral-200 bg-white p-6 shadow-sm">
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
                    <th className="px-4 py-2">Fecha</th>
                    <th className="px-4 py-2">Producto</th>
                    <th className="px-4 py-2 text-right">Cant.</th>
                    <th className="px-4 py-2 text-right">Total</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-neutral-100">
                  {pendingItems.map((i) => (
                    <tr key={i.id}>
                      <td className="px-4 py-2 text-neutral-600">{DATE_FMT.format(i.requestedAt)}</td>
                      <td className="px-4 py-2">{i.productName}</td>
                      <td className="px-4 py-2 text-right tabular-nums">{i.quantity}</td>
                      <td className="px-4 py-2 text-right tabular-nums">{money(i.totalCost)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
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
                    <th className="px-4 py-2">Fecha</th>
                    <th className="px-4 py-2">Producto</th>
                    <th className="px-4 py-2 text-right">Cant.</th>
                    <th className="px-4 py-2">Detalle</th>
                    <th className="px-4 py-2 text-right">Valor si se resuelve</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-amber-100">
                  {disputedItems.map((i) => (
                    <tr key={i.id}>
                      <td className="px-4 py-2 text-amber-800">{DATE_FMT.format(i.requestedAt)}</td>
                      <td className="px-4 py-2 text-amber-900">{i.productName}</td>
                      <td className="px-4 py-2 text-right tabular-nums text-amber-800">{i.quantity}</td>
                      <td className="px-4 py-2 text-amber-800">
                        {[
                          i.damagedQty > 0 ? `${i.damagedQty} dañadas` : null,
                          i.incompleteQty > 0 ? `${i.incompleteQty} incompletas` : null,
                          i.differentQty > 0 ? `${i.differentQty} distintas` : null,
                        ]
                          .filter(Boolean)
                          .join(", ")}
                      </td>
                      <td className="px-4 py-2 text-right tabular-nums text-amber-800">{money(i.wouldBeValue)}</td>
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
            <div className="space-y-4">
              {closedPayments.map((p) => (
                <div key={p.id} className="rounded-xl border border-neutral-200 bg-white p-5 shadow-sm">
                  <div className="mb-3 flex items-baseline justify-between">
                    <span className="text-sm font-medium text-neutral-700">{p.code}</span>
                    <span className="text-sm tabular-nums text-neutral-500">{money(p.totalAmount)}</span>
                  </div>
                  <ul className="mb-3 space-y-1 text-sm text-neutral-600">
                    {p.requests.map((r) => (
                      <li key={r.id} className="flex justify-between">
                        <span>
                          {r.catalogItem.name} × {r.quantity}
                        </span>
                        <span className="tabular-nums">{money(r.totalCost)}</span>
                      </li>
                    ))}
                  </ul>
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
