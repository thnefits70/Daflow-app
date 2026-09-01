import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { auth } from "@/auth";
import { prisma } from "@/lib/prisma";
import { canDeclareExternalSales } from "@/lib/guards";
import { notifyMarketingLeadNewExternalSale } from "@/lib/externalSales";

const schema = z.object({
  catalogItemId: z.string().min(1, "Falta el producto."),
  quantity: z.number().int().positive(),
  unitPrice: z.number().positive(),
});

async function recomputeSaleTotal(saleId: string) {
  const items = await prisma.externalSaleItem.findMany({ where: { saleId }, select: { totalAmount: true } });
  await prisma.externalSale.update({ where: { id: saleId }, data: { totalAmount: items.reduce((sum, it) => sum + it.totalAmount, 0) } });
}

// Confirmado 2026-09-01, pedido explícito del usuario: cuando Bryan rechaza
// un producto puntual (ver /reject), el asesor dueño de la venta corrige
// SOLO ese renglón — sin tener que reenviar toda la venta de nuevo, y sin
// perder los demás productos que ya estaban bien.
export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string; itemId: string }> }) {
  const session = await auth();
  if (!(await canDeclareExternalSales()) || !session) return NextResponse.json({ error: "No autorizado." }, { status: 403 });

  const { id, itemId } = await params;
  const body = await req.json().catch(() => null);
  const parsed = schema.safeParse(body);
  if (!parsed.success) return NextResponse.json({ error: parsed.error.issues[0]?.message ?? "Datos inválidos." }, { status: 400 });

  const sale = await prisma.externalSale.findUnique({ where: { id }, select: { advisorId: true, reviewStatus: true, code: true } });
  if (!sale) return NextResponse.json({ error: "No encontrado." }, { status: 404 });
  if (sale.advisorId !== session.user.id && session.user.role !== "admin") return NextResponse.json({ error: "No autorizado." }, { status: 403 });
  if (sale.reviewStatus !== "PENDING") return NextResponse.json({ error: "Esta venta ya no está pendiente de revisión." }, { status: 409 });

  const item = await prisma.externalSaleItem.findUnique({ where: { id: itemId }, select: { saleId: true, rejectedAt: true } });
  if (!item || item.saleId !== id) return NextResponse.json({ error: "Producto no encontrado." }, { status: 404 });
  if (!item.rejectedAt) return NextResponse.json({ error: "Este producto no está rechazado." }, { status: 409 });

  const catalogItem = await prisma.purchaseCatalogItem.findUnique({ where: { id: parsed.data.catalogItemId }, select: { name: true } });
  if (!catalogItem) return NextResponse.json({ error: "Producto no encontrado en el catálogo." }, { status: 404 });

  await prisma.externalSaleItem.update({
    where: { id: itemId },
    data: {
      catalogItemId: parsed.data.catalogItemId,
      declaredProductName: catalogItem.name,
      quantity: parsed.data.quantity,
      unitPrice: parsed.data.unitPrice,
      totalAmount: parsed.data.quantity * parsed.data.unitPrice,
      rejectedAt: null,
      rejectionReason: null,
    },
  });
  await recomputeSaleTotal(id);
  await notifyMarketingLeadNewExternalSale(sale.code);

  return NextResponse.json({ ok: true });
}

// El asesor puede eliminar directamente un producto rechazado en vez de
// corregirlo (ej. lo agregó por error) — siempre debe quedar al menos un
// producto en la venta.
export async function DELETE(_req: NextRequest, { params }: { params: Promise<{ id: string; itemId: string }> }) {
  const session = await auth();
  if (!(await canDeclareExternalSales()) || !session) return NextResponse.json({ error: "No autorizado." }, { status: 403 });

  const { id, itemId } = await params;
  const sale = await prisma.externalSale.findUnique({ where: { id }, select: { advisorId: true, reviewStatus: true, code: true } });
  if (!sale) return NextResponse.json({ error: "No encontrado." }, { status: 404 });
  if (sale.advisorId !== session.user.id && session.user.role !== "admin") return NextResponse.json({ error: "No autorizado." }, { status: 403 });
  if (sale.reviewStatus !== "PENDING") return NextResponse.json({ error: "Esta venta ya no está pendiente de revisión." }, { status: 409 });

  const item = await prisma.externalSaleItem.findUnique({ where: { id: itemId }, select: { saleId: true, rejectedAt: true } });
  if (!item || item.saleId !== id) return NextResponse.json({ error: "Producto no encontrado." }, { status: 404 });
  if (!item.rejectedAt) return NextResponse.json({ error: "Este producto no está rechazado." }, { status: 409 });

  const itemCount = await prisma.externalSaleItem.count({ where: { saleId: id } });
  if (itemCount <= 1) return NextResponse.json({ error: "No se puede eliminar: es el único producto de la venta. Elimina la venta completa en cambio." }, { status: 409 });

  await prisma.externalSaleItem.delete({ where: { id: itemId } });
  await recomputeSaleTotal(id);
  await notifyMarketingLeadNewExternalSale(sale.code);

  return NextResponse.json({ ok: true });
}
