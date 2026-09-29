import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { auth } from "@/auth";
import { canSubmitPurchaseRequests } from "@/lib/guards";
import { notifySupplierStockoutReported } from "@/lib/supplierStockout";

// Confirmado 2026-09-29, pedido de Bryan (vía el usuario): Daniel solo avisa
// que NO LLEGÓ (su "Enviar a Compras" de siempre); quien sabe y dice que el
// proveedor no tiene stock es Jariel, que habla con él. Desde Reportes
// urgentes, sobre lo faltante:
//   · Marca el reporte "sin stock del proveedor" (la hoja de CHEN lo muestra
//     como "pendiente de acordar" hasta que se registre el descuento).
//   · Crea solo el aviso "Sin stock de proveedor" para Heidy/Bryan (cerrar
//     el ID en Dropi o bajar el stock) — ya no lo llena aparte.
// No descuenta nada: el descuento ("No se paga (se descuenta en la tanda)")
// o la devolución se registran aparte, con la captura del proveedor que
// revisa la IA (resolutions/route.ts). Nada se descuenta sin prueba.
export async function POST(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const session = await auth();
  const isAdmin = session?.user.role === "admin";
  if (!session || (!isAdmin && !(await canSubmitPurchaseRequests()))) {
    return NextResponse.json({ error: "No autorizado." }, { status: 403 });
  }

  const { id } = await params;
  const existing = await prisma.purchaseRequestUrgentReport.findUnique({
    where: { id },
    include: {
      request: {
        select: {
          requestedById: true,
          catalogItemId: true,
          catalogItem: { select: { name: true } },
          supplier: { select: { name: true } },
        },
      },
    },
  });
  if (!existing) return NextResponse.json({ error: "No encontrado." }, { status: 404 });
  if (!existing.reviewedByLeadAt || existing.rejectedAt) return NextResponse.json({ error: "Este reporte todavía no llegó a Compras." }, { status: 409 });
  if (existing.isLateClaim || existing.missingQty <= 0) return NextResponse.json({ error: "Solo se puede marcar sobre unidades que no llegaron." }, { status: 400 });
  if (existing.supplierStockoutAt) return NextResponse.json({ error: "Ya está marcado como sin stock del proveedor." }, { status: 409 });

  const actorId = isAdmin ? null : session.user.id;
  const updated = await prisma.purchaseRequestUrgentReport.update({
    where: { id },
    data: { supplierStockoutAt: new Date(), supplierStockoutById: actorId },
  });

  const supplierName = existing.request.supplier.name;
  const itemName = existing.request.catalogItem.name;
  // Aviso a marketing — se crea solo si no hay ya uno abierto de ese producto.
  try {
    const reporterId = actorId ?? existing.request.requestedById;
    const alreadyOpen = await prisma.supplierStockoutReport.findFirst({
      where: { catalogItemId: existing.request.catalogItemId, resolvedAt: null },
      select: { id: true },
    });
    if (reporterId && !alreadyOpen) {
      const instructionNote = `${supplierName} no tiene stock — ${existing.missingQty} un. no van a llegar. Revisen si cerrar el ID en Dropi o bajar el stock.`;
      const created = await prisma.supplierStockoutReport.create({
        data: { catalogItemId: existing.request.catalogItemId, instructionNote, reportedById: reporterId },
        include: { reportedBy: { select: { name: true } } },
      });
      await notifySupplierStockoutReported({ catalogItemName: itemName, instructionNote, reportedByName: created.reportedBy.name });
    }
  } catch (err) {
    console.error("[urgent-report supplier-stockout] aviso a marketing:", err);
  }

  return NextResponse.json(updated);
}
