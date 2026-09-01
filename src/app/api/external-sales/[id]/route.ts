import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { auth } from "@/auth";
import { prisma } from "@/lib/prisma";
import { canDeclareExternalSales } from "@/lib/guards";
import { notifyMarketingLeadNewExternalSale } from "@/lib/externalSales";

const itemSchema = z.object({
  catalogItemId: z.string().min(1, "Falta el producto."),
  quantity: z.number().int().positive(),
  unitPrice: z.number().positive(),
});

const schema = z.object({
  items: z.array(itemSchema).min(1, "Agrega al menos un producto."),
  pickupPersonName: z.string().trim().min(1, "Falta a quién debe entregársela bodega."),
  courierNote: z.string().trim().optional(),
  clientId: z.string().min(1, "Falta matricular o seleccionar al cliente."),
});

async function resolveItems(items: z.infer<typeof itemSchema>[]) {
  const catalogItems = await prisma.purchaseCatalogItem.findMany({
    where: { id: { in: items.map((it) => it.catalogItemId) } },
    select: { id: true, name: true },
  });
  const byId = new Map(catalogItems.map((c) => [c.id, c.name]));
  for (const it of items) {
    if (!byId.has(it.catalogItemId)) throw new Error("Uno de los productos no se encontró en el catálogo.");
  }
  return items.map((it) => ({
    catalogItemId: it.catalogItemId,
    declaredProductName: byId.get(it.catalogItemId)!,
    quantity: it.quantity,
    unitPrice: it.unitPrice,
    totalAmount: it.quantity * it.unitPrice,
  }));
}

// Confirmado 2026-08-29, pedido explícito del usuario: si Bryan rechaza,
// el asesor corrige lo señalado y reenvía la MISMA venta (mismo código),
// sin perder lo demás — solo posible mientras siga en REJECTED. Reemplaza
// todos los productos de la venta (confirmado 2026-09-01: ahora puede tener
// varios) — para corregir un solo producto sin tumbar toda la venta, ver
// /items/[itemId].
export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const session = await auth();
  if (!(await canDeclareExternalSales()) || !session) return NextResponse.json({ error: "No autorizado." }, { status: 403 });

  const { id } = await params;
  const body = await req.json().catch(() => null);
  const parsed = schema.safeParse(body);
  if (!parsed.success) return NextResponse.json({ error: parsed.error.issues[0]?.message ?? "Datos inválidos." }, { status: 400 });

  const sale = await prisma.externalSale.findUnique({ where: { id }, select: { advisorId: true, reviewStatus: true, code: true } });
  if (!sale) return NextResponse.json({ error: "No encontrado." }, { status: 404 });
  if (sale.advisorId !== session.user.id && session.user.role !== "admin") return NextResponse.json({ error: "No autorizado." }, { status: 403 });
  if (sale.reviewStatus !== "REJECTED") return NextResponse.json({ error: "Solo se puede corregir una venta rechazada." }, { status: 409 });

  const client = await prisma.client.findUnique({ where: { id: parsed.data.clientId }, select: { id: true } });
  if (!client) return NextResponse.json({ error: "Cliente no encontrado." }, { status: 404 });

  let resolvedItems;
  try {
    resolvedItems = await resolveItems(parsed.data.items);
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : "Producto no encontrado en el catálogo." }, { status: 404 });
  }

  const updated = await prisma.$transaction(async (tx) => {
    await tx.externalSaleItem.deleteMany({ where: { saleId: id } });
    return tx.externalSale.update({
      where: { id },
      data: {
        totalAmount: resolvedItems.reduce((sum, it) => sum + it.totalAmount, 0),
        items: { create: resolvedItems },
        pickupPersonName: parsed.data.pickupPersonName,
        courierNote: parsed.data.courierNote?.trim() || null,
        clientId: parsed.data.clientId,
        reviewStatus: "PENDING",
        rejectionReason: null,
        reviewedAt: null,
        reviewedById: null,
      },
    });
  });

  await notifyMarketingLeadNewExternalSale(sale.code);
  return NextResponse.json(updated);
}

// Admin puede eliminar una venta entera para volver a declararla desde cero
// (ej. se equivocaron de producto/monto) — solo mientras el stock no haya
// salido de bodega todavía (sin outflowBatchId), para no dejar un egreso de
// inventario huérfano apuntando a una venta que ya no existe. Baja lógica,
// no delete real: el código (VE-000X) queda en Historial marcado como
// eliminado, con fecha, en vez de desaparecer sin dejar rastro.
export async function DELETE(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const session = await auth();
  if (!session || session.user.role !== "admin") return NextResponse.json({ error: "No autorizado." }, { status: 403 });

  const { id } = await params;
  const sale = await prisma.externalSale.findUnique({ where: { id }, select: { outflowBatchId: true, deletedAt: true } });
  if (!sale) return NextResponse.json({ error: "No encontrado." }, { status: 404 });
  if (sale.deletedAt) return NextResponse.json({ error: "Ya fue eliminada." }, { status: 409 });
  if (sale.outflowBatchId) return NextResponse.json({ error: "No se puede eliminar: el stock ya salió de bodega para esta venta." }, { status: 409 });

  await prisma.externalSale.update({ where: { id }, data: { deletedAt: new Date(), deletedById: session.user.id } });
  return NextResponse.json({ ok: true });
}
