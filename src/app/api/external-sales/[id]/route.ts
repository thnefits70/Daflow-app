import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { auth } from "@/auth";
import { prisma } from "@/lib/prisma";
import { canDeclareExternalSales } from "@/lib/guards";
import { notifyMarketingLeadNewExternalSale } from "@/lib/externalSales";

const schema = z.object({
  catalogItemId: z.string().min(1).optional(),
  declaredProductName: z.string().trim().min(1).optional(),
  quantity: z.number().int().positive(),
  unitPrice: z.number().positive(),
  pickupPersonName: z.string().trim().min(1, "Falta a quién debe entregársela bodega."),
  courierNote: z.string().trim().optional(),
  clientId: z.string().min(1, "Falta matricular o seleccionar al cliente."),
});

// Confirmado 2026-08-29, pedido explícito del usuario: si Bryan rechaza,
// el asesor corrige lo señalado y reenvía la MISMA venta (mismo código),
// sin perder lo demás — solo posible mientras siga en REJECTED.
export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const session = await auth();
  if (!(await canDeclareExternalSales()) || !session) return NextResponse.json({ error: "No autorizado." }, { status: 403 });

  const { id } = await params;
  const body = await req.json().catch(() => null);
  const parsed = schema.safeParse(body);
  if (!parsed.success) return NextResponse.json({ error: parsed.error.issues[0]?.message ?? "Datos inválidos." }, { status: 400 });
  if (!parsed.data.catalogItemId && !parsed.data.declaredProductName) return NextResponse.json({ error: "Falta el producto." }, { status: 400 });

  const sale = await prisma.externalSale.findUnique({ where: { id }, select: { advisorId: true, reviewStatus: true, code: true } });
  if (!sale) return NextResponse.json({ error: "No encontrado." }, { status: 404 });
  if (sale.advisorId !== session.user.id && session.user.role !== "admin") return NextResponse.json({ error: "No autorizado." }, { status: 403 });
  if (sale.reviewStatus !== "REJECTED") return NextResponse.json({ error: "Solo se puede corregir una venta rechazada." }, { status: 409 });

  const client = await prisma.client.findUnique({ where: { id: parsed.data.clientId }, select: { id: true } });
  if (!client) return NextResponse.json({ error: "Cliente no encontrado." }, { status: 404 });

  let declaredProductName = parsed.data.declaredProductName ?? "";
  if (parsed.data.catalogItemId) {
    const catalogItem = await prisma.purchaseCatalogItem.findUnique({ where: { id: parsed.data.catalogItemId }, select: { name: true } });
    if (!catalogItem) return NextResponse.json({ error: "Producto no encontrado en el catálogo." }, { status: 404 });
    declaredProductName = catalogItem.name;
  }

  const updated = await prisma.externalSale.update({
    where: { id },
    data: {
      catalogItemId: parsed.data.catalogItemId ?? null,
      declaredProductName,
      quantity: parsed.data.quantity,
      unitPrice: parsed.data.unitPrice,
      totalAmount: parsed.data.quantity * parsed.data.unitPrice,
      pickupPersonName: parsed.data.pickupPersonName,
      courierNote: parsed.data.courierNote?.trim() || null,
      clientId: parsed.data.clientId,
      reviewStatus: "PENDING",
      rejectionReason: null,
      reviewedAt: null,
      reviewedById: null,
    },
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
