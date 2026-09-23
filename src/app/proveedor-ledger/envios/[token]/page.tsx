import { notFound } from "next/navigation";
import type { Metadata } from "next";
import { prisma } from "@/lib/prisma";
import { findSupplierByPublicShippingToken, SUPPLIER_PUBLIC_LINK_START } from "@/lib/supplierDebt";
import { SupplierPendingShipmentsList } from "@/components/supplier-ledger/SupplierPendingShipmentsList";
import { SupplierShipmentHistoryTable } from "@/components/supplier-ledger/SupplierShipmentHistoryTable";
import { SupplierShippingPushToggle } from "@/components/supplier-ledger/SupplierShippingPushToggle";
import { firstName } from "@/lib/actorName";

// Confirmado 2026-09-17, pedido explícito del usuario: segundo enlace,
// llave completamente aparte de /proveedor-ledger/[token] (el del saldo) —
// pensado para que el proveedor de crédito (hoy solo CHEN) se lo pase a SU
// PROPIO equipo de despacho. Muestra ÚNICAMENTE los pedidos que faltan
// enviar (producto/cantidad) — nunca el saldo, nunca la plata que se le
// debe. Valida solo publicShippingToken (findSupplierByPublicShippingToken)
// — aunque alguien edite esta URL, esta llave nunca abre la página del
// saldo, porque esa valida un campo distinto (publicLedgerToken).
// Confirmado 2026-09-23: manifest propio por enlace (con su token) para que
// en iPhone se pueda "Añadir a pantalla de inicio" y así recibir avisos push
// (ver SupplierShippingPushToggle).
export async function generateMetadata({ params }: { params: Promise<{ token: string }> }): Promise<Metadata> {
  const { token } = await params;
  return {
    title: "Pedidos por enviar",
    description: "Lista de pedidos pendientes de envío.",
    icons: {
      icon: "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=",
    },
    manifest: `/proveedor-ledger/envios/${token}/manifest`,
    appleWebApp: { capable: true, title: "Pedidos", statusBarStyle: "default" },
  };
}

export default async function SupplierShippingLedgerPage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  const supplier = await findSupplierByPublicShippingToken(token);
  if (!supplier || supplier.paymentMode !== "CREDITO") notFound();

  const include = {
    // Confirmado 2026-09-17, pedido explícito del usuario: mostrarle a
    // Chen una foto del producto — la ÚLTIMA que se subió al matricularlo
    // (PurchaseCatalogItem.photos, orden de subida), sin ningún texto ni
    // marca nuestra encima, la imagen tal cual.
    catalogItem: { select: { name: true, photos: true } },
    // Confirmado 2026-09-17, pedido explícito del usuario: además de quién
    // aprobó (Bryan, normalmente), mostrar quién solicitó la compra —
    // normalmente Jariel o Nairoby; en una emergencia (Bryan solicita), el
    // que aprueba pasa a ser el admin, nunca la misma persona (ver
    // isEmergency en schema.prisma). Un solo nombre en cada columna.
    requestedBy: { select: { name: true } },
    reviewedBy: { select: { name: true } },
  } as const;

  // Confirmado 2026-09-22, pedido explícito del usuario: igual que el enlace
  // principal, el equipo de CHEN solo ve solicitudes hechas desde el
  // 21-sep-2026 (SUPPLIER_PUBLIC_LINK_START).
  const since = SUPPLIER_PUBLIC_LINK_START;
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
        requestedAt: { gte: since },
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
      where: { supplierId: supplier.id, supplierShippingConfirmedAt: { not: null }, requestedAt: { gte: since } },
      include,
      orderBy: { supplierShippingConfirmedAt: "desc" },
    }),
  ]);

  return (
    <div className="min-h-screen bg-neutral-50 text-neutral-900">
      <div className="mx-auto max-w-[1600px] px-3 py-5 sm:px-6 sm:py-10">
        <header className="mb-5 sm:mb-8">
          <h1 className="text-xl font-semibold tracking-tight">Pedidos por enviar</h1>
          <p className="mt-1 text-sm text-neutral-500">Actualizado en tiempo real. Esta página es de solo lectura.</p>
        </header>

        <SupplierShippingPushToggle token={token} />

        <section className="mb-8">
          <div className="mb-1 flex items-center gap-2">
            <h2 className="text-sm font-medium text-neutral-700">Falta enviar</h2>
            <span className="rounded-full bg-neutral-200 px-2 py-0.5 text-xs font-medium tabular-nums text-neutral-700">{pendingShipments.length}</span>
          </div>
          <p className="mb-3 text-xs text-neutral-500">
            Subir una foto en tiempo real de lo que están enviando es opcional — solo un refuerzo, no hace falta para nada más. Cuando
            despachen un pedido, aprieten “Ya lo enviamos” (con foto o sin ella) para pasarlo al historial de abajo.
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

        <section>
          <h2 className="mb-3 text-sm font-medium text-neutral-700">Historial de lo que ya se despachó a la bodega TBS</h2>
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
      </div>
    </div>
  );
}
