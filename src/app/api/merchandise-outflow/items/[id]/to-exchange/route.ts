import { NextResponse } from "next/server";
import { auth } from "@/auth";
import { prisma } from "@/lib/prisma";
import { canActOnMerchandiseOutflow } from "@/lib/guards";
import { nextMerchandiseOutflowNumber, formatMerchandiseOutflowCode } from "@/lib/merchandiseOutflow";

// Confirmado 2026-09-23, pedido de Daniel: "Armar paquete de cambio" desde
// Seguimiento de deterioro. Cuando Jariel ya registró que el proveedor
// acepta el cambio (purchaseResolution REPLACED), el producto pasa solo al
// borrador de "Cambio con proveedor" de Daniel — proveedor, producto y
// cantidad ya puestos; Daniel solo toma la foto de la lista y lo deja listo.
// El ítem nuevo entra YA resuelto como REPLACED (el cambio ya lo negoció
// Jariel, nadie lo vuelve a gestionar) y marcado con sourceDeteriorItemId,
// que hace que el envío del lote no vuelva a restar Kardex (el deterioro ya
// lo restó al reportarse). Si Daniel lo quita del borrador, el deterioro
// queda libre para volver a empacarse.
export async function POST(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const session = await auth();
  if (!session || !(await canActOnMerchandiseOutflow())) return NextResponse.json({ error: "No autorizado." }, { status: 403 });

  const { id } = await params;
  const source = await prisma.merchandiseOutflowItem.findUnique({
    where: { id },
    include: {
      batch: { select: { reason: true } },
      purchaseGestionSupplier: { select: { id: true, name: true } },
      exchangeItem: { select: { id: true } },
    },
  });
  if (!source) return NextResponse.json({ error: "No encontrado." }, { status: 404 });
  // Confirmado 2026-09-23, pedido de Daniel: también con CRÉDITO — el
  // proveedor solo da el saldo a favor si recibe la mercadería de vuelta,
  // así que igual hay que armar el paquete. El ítem nuevo entra como
  // CREDIT_ISSUED SIN crear otro SupplierCredit (ya existe en el deterioro;
  // supplier-exchange/route.ts lo muestra desde ahí).
  if (
    source.batch.reason !== "DETERIORO" ||
    source.resolution !== "ESCALATED_TO_PURCHASES" ||
    (source.purchaseResolution !== "REPLACED" && source.purchaseResolution !== "CREDIT_ISSUED")
  ) {
    return NextResponse.json({ error: "Solo se puede armar el paquete cuando el proveedor ya aceptó (cambio o crédito)." }, { status: 400 });
  }
  const isCredit = source.purchaseResolution === "CREDIT_ISSUED";
  if (!source.purchaseGestionSupplier) return NextResponse.json({ error: "Falta el proveedor confirmado por Jariel." }, { status: 409 });
  if (source.exchangeItem) return NextResponse.json({ error: "Este producto ya está en un paquete de devolución." }, { status: 409 });

  const supplier = source.purchaseGestionSupplier;
  let draft = await prisma.merchandiseOutflowBatch.findFirst({
    where: { createdById: session.user.id, reason: "CAMBIO_PROVEEDOR", submittedAt: null },
    include: { supplier: { select: { id: true, name: true } } },
  });
  if (draft && draft.supplierId !== supplier.id) {
    return NextResponse.json(
      { error: `Ya tienes un paquete abierto para ${draft.supplier?.name ?? "otro proveedor"} (${draft.code}). Déjalo listo o cancélalo en "Mercadería devuelta al proveedor" y vuelve a intentar.` },
      { status: 409 }
    );
  }
  if (!draft) {
    const batchNumber = await nextMerchandiseOutflowNumber();
    draft = await prisma.merchandiseOutflowBatch.create({
      data: { code: formatMerchandiseOutflowCode(batchNumber), batchNumber, reason: "CAMBIO_PROVEEDOR", createdById: session.user.id, supplierId: supplier.id },
      include: { supplier: { select: { id: true, name: true } } },
    });
  }

  await prisma.merchandiseOutflowItem.create({
    data: {
      batchId: draft.id,
      catalogItemId: source.catalogItemId,
      declaredName: source.declaredName,
      quantity: source.quantity,
      linkedPurchaseRequestId: source.linkedPurchaseRequestId,
      unitCostAtExchange: source.unitCostAtExchange,
      expectedCreditAmount: source.expectedCreditAmount,
      sourceDeteriorItemId: source.id,
      resolution: isCredit ? "CREDIT_ISSUED" : "REPLACED",
      resolutionNote: source.purchaseResolutionNote ?? (isCredit ? "Crédito ya acordado con el proveedor desde el deterioro." : "Cambio ya acordado con el proveedor desde el deterioro."),
      resolvedAt: source.purchaseResolvedAt ?? new Date(),
      resolvedById: source.purchaseResolvedById,
    },
  });

  return NextResponse.json({ batchId: draft.id, code: draft.code });
}
