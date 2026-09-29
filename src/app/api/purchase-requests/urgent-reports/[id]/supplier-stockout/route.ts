import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { auth } from "@/auth";
import { canActOnPurchaseReceiving, getInventoryLeadId } from "@/lib/guards";
import { notifyOwner } from "@/lib/notifications";
import { registerGoodUnitsFromUrgentReport } from "@/lib/purchaseReceiptFromReport";
import { notifySupplierStockoutReported } from "@/lib/supplierStockout";

const schema = z.object({
  missingQty: z.number().int().positive("Indica cuántas unidades no van a llegar."),
});

// Confirmado 2026-09-29, pedido de Daniel + usuario (caso: 200 almohadas que
// CHEN nunca trajo ni va a traer): tercer camino además de "enviar a Compras"
// y "resolver internamente" — lo faltante NUNCA va a llegar porque el
// proveedor se quedó sin stock. Daniel SOLO lo marca:
//   · El reporte pasa a Compras marcado "sin stock" y se avisa a quien hizo
//     la compra (Jariel). Nada se descuenta solo — ni con CHEN: Jariel
//     registra "No se paga (se descuenta en la tanda)" (o devolución/crédito
//     con otros proveedores) en Reportes urgentes, con la captura del
//     proveedor que revisa la IA. Así nada se descuenta sin prueba. Mientras
//     tanto el pedido queda retenido (isReportBlockingDebtPayment).
//   · Aviso "Sin stock de proveedor" a Heidy/Bryan de marketing.
// Lo dañado/incompleto/distinto del mismo reporte sigue su camino normal.
export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const session = await auth();
  if (!(await canActOnPurchaseReceiving()) || !session) return NextResponse.json({ error: "No autorizado." }, { status: 403 });

  const { id } = await params;
  const body = await req.json().catch(() => ({}));
  const parsed = schema.safeParse(body ?? {});
  if (!parsed.success) return NextResponse.json({ error: parsed.error.issues[0]?.message ?? "Datos inválidos." }, { status: 400 });

  const existing = await prisma.purchaseRequestUrgentReport.findUnique({
    where: { id },
    include: {
      request: {
        select: {
          id: true,
          quantity: true,
          unitCost: true,
          requestedById: true,
          catalogItemId: true,
          catalogItem: { select: { name: true } },
          supplier: { select: { name: true, paymentMode: true } },
        },
      },
    },
  });
  if (!existing) return NextResponse.json({ error: "No encontrado." }, { status: 404 });
  if (existing.reviewedByLeadAt) return NextResponse.json({ error: "Ya fue revisado." }, { status: 409 });
  if (existing.isLateClaim) return NextResponse.json({ error: "Un reclamo posterior al cierre no se puede marcar por acá." }, { status: 400 });

  const missingQty = parsed.data.missingQty;
  const flaggedQty = existing.damagedQty + existing.incompleteQty + existing.differentQty;
  if (flaggedQty + missingQty > existing.request.quantity) {
    return NextResponse.json({ error: `No puede dejar el total en más de lo pedido (${existing.request.quantity} un.).` }, { status: 400 });
  }

  const isAdmin = session.user.role === "admin";
  const actorId = isAdmin ? null : session.user.id;
  const isCreditSupplier = existing.request.supplier.paymentMode === "CREDITO";
  const supplierName = existing.request.supplier.name;
  const itemName = existing.request.catalogItem.name;
  const amount = Math.round(missingQty * existing.request.unitCost * 100) / 100;
  const now = new Date();

  const updated = await prisma.purchaseRequestUrgentReport.update({
    where: { id },
    data: {
      missingQty,
      reviewedByLeadId: actorId,
      reviewedByLeadAt: now,
      supplierStockoutAt: now,
      supplierStockoutById: actorId,
    },
  });

  // Aviso a quien hizo la compra (Jariel) + admin: le toca registrar el
  // descuento (CHEN) o pedir devolución/crédito (otros), con captura.
  const notifyTargets = new Set<string>(["admin"]);
  if (existing.request.requestedById) notifyTargets.add(existing.request.requestedById);
  const notifyBody = isCreditSupplier
    ? `${itemName} — ${missingQty} un. no van a llegar (${supplierName} no tiene). Registra "No se paga (se descuenta en la tanda)" con la captura de ${supplierName}.`
    : `${itemName} — ${missingQty} un. no van a llegar (${supplierName} no tiene) · $${amount.toFixed(2)} por recuperar: pide devolución o crédito.`;
  await Promise.all(
    [...notifyTargets].map((ownerId) =>
      notifyOwner(ownerId, {
        title: "🚫 Proveedor sin stock — no va a llegar",
        body: notifyBody,
        url: ownerId === "admin" ? "/admin" : "/area/workspace?tab=compras&ptab=urgentes",
      }).catch(() => null)
    )
  );

  // Aviso a marketing (Heidy/Bryan) para cerrar el ID en Dropi o bajar el
  // stock — se crea solo si no hay ya uno abierto de ese producto.
  try {
    const reporterId = actorId ?? (await getInventoryLeadId());
    const alreadyOpen = await prisma.supplierStockoutReport.findFirst({
      where: { catalogItemId: existing.request.catalogItemId, resolvedAt: null },
      select: { id: true },
    });
    if (reporterId && !alreadyOpen) {
      const instructionNote = `${supplierName} no tiene stock — ${missingQty} un. no van a llegar. Revisen si cerrar el ID en Dropi o bajar el stock.`;
      const created = await prisma.supplierStockoutReport.create({
        data: { catalogItemId: existing.request.catalogItemId, instructionNote, reportedById: reporterId },
        include: { reportedBy: { select: { name: true } } },
      });
      await notifySupplierStockoutReported({ catalogItemName: itemName, instructionNote, reportedByName: created.reportedBy.name });
    }
  } catch (err) {
    console.error("[urgent-report supplier-stockout] aviso a marketing:", err);
  }

  // La parte buena queda registrada sola, igual que al enviar a Compras.
  await registerGoodUnitsFromUrgentReport(existing.request.id, { id: session.user.id, isAdmin, isLead: !isAdmin }).catch((err) =>
    console.error("[urgent-report supplier-stockout] No se pudo registrar la parte buena:", err)
  );

  return NextResponse.json(updated);
}
