import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { auth } from "@/auth";
import { prisma } from "@/lib/prisma";
import { canDeclareExternalSales, dbUserId } from "@/lib/guards";
import { notifyMarketingLeadNewExternalSale, notifyEveryoneExternalSaleCancelled, priceExternalSaleItems } from "@/lib/externalSales";

const itemSchema = z.object({
  catalogItemId: z.string().min(1, "Falta el producto."),
  quantity: z.number().int().positive(),
  marginPercent: z.number().optional(),
  sellerReferencePhotoUrl: z.string().url().optional(),
});

const schema = z.object({
  items: z.array(itemSchema).min(1, "Agrega al menos un producto."),
  pickupPersonName: z.string().trim().min(1, "Falta a quién debe entregársela bodega."),
  courierNote: z.string().trim().optional(),
  clientId: z.string().min(1, "Falta matricular o seleccionar al cliente."),
  freightCost: z.number().min(0).optional(),
  facturaSolicitada: z.enum(["SI", "NO", "PENDIENTE"]).optional(),
});

async function resolveItems(items: z.infer<typeof itemSchema>[], useB2CPricing: boolean) {
  const catalogItems = await prisma.purchaseCatalogItem.findMany({
    where: { id: { in: items.map((it) => it.catalogItemId) } },
    select: { id: true, name: true },
  });
  const byId = new Map(catalogItems.map((c) => [c.id, c.name]));
  for (const it of items) {
    if (!byId.has(it.catalogItemId)) throw new Error("Uno de los productos no se encontró en el catálogo.");
  }

  const priced = await priceExternalSaleItems({ useB2CPricing, items });
  if (!priced.ok) throw new Error(priced.error);

  return items.map((it, i) => {
    const price = priced.items[i];
    return {
      catalogItemId: it.catalogItemId,
      declaredProductName: byId.get(it.catalogItemId)!,
      quantity: it.quantity,
      unitPrice: price.unitPrice,
      totalAmount: it.quantity * price.unitPrice,
      marginPercentUsed: price.marginPercentUsed,
      sellerReferencePhotoUrl: it.sellerReferencePhotoUrl ?? null,
    };
  });
}

// Confirmado 2026-08-29, pedido explícito del usuario: si Bryan rechaza,
// el asesor corrige lo señalado y reenvía la MISMA venta (mismo código),
// sin perder lo demás — solo posible mientras siga en REJECTED. Reemplaza
// todos los productos de la venta (confirmado 2026-09-01: ahora puede tener
// varios) — para corregir un solo producto sin tumbar toda la venta, ver
// /items/[itemId].
// Ampliado 2026-09-10, pedido de Marcos: el asesor también puede editar su
// propia venta mientras siga PENDING (todavía no la vio Bryan) — mismo
// mecanismo, sin esperar a que la rechace primero. Una vez que Bryan la
// aprueba, esta ruta ya no acepta cambios.
export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const session = await auth();
  if (!(await canDeclareExternalSales()) || !session) return NextResponse.json({ error: "No autorizado." }, { status: 403 });

  const { id } = await params;
  const body = await req.json().catch(() => null);
  const parsed = schema.safeParse(body);
  if (!parsed.success) return NextResponse.json({ error: parsed.error.issues[0]?.message ?? "Datos inválidos." }, { status: 400 });

  const sale = await prisma.externalSale.findUnique({
    where: { id },
    select: { advisorId: true, reviewStatus: true, code: true, deletedAt: true, isContraEntrega: true, advisor: { select: { externalSaleContraEntrega: true } } },
  });
  if (!sale) return NextResponse.json({ error: "No encontrado." }, { status: 404 });
  if (sale.advisorId !== session.user.id && session.user.role !== "admin") return NextResponse.json({ error: "No autorizado." }, { status: 403 });
  if (sale.deletedAt) return NextResponse.json({ error: "Esta venta ya fue cancelada." }, { status: 409 });
  if (sale.reviewStatus !== "REJECTED" && sale.reviewStatus !== "PENDING") {
    return NextResponse.json({ error: "Solo se puede editar mientras está pendiente o rechazada — ya fue aprobada por Bryan." }, { status: 409 });
  }

  const client = await prisma.client.findUnique({ where: { id: parsed.data.clientId }, select: { id: true } });
  if (!client) return NextResponse.json({ error: "Cliente no encontrado." }, { status: 404 });

  // La fórmula de precio depende del perfil del asesor (B2C para Marcos),
  // no del isContraEntrega guardado en esta venta puntual — ver comentario
  // en priceExternalSaleItems.
  let resolvedItems;
  try {
    resolvedItems = await resolveItems(parsed.data.items, sale.advisor.externalSaleContraEntrega);
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : "No se pudo calcular el precio." }, { status: 400 });
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
        freightCost: parsed.data.freightCost ?? null,
        facturaSolicitada: sale.isContraEntrega ? (parsed.data.facturaSolicitada ?? "PENDIENTE") : "PENDIENTE",
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

// Admin puede eliminar CUALQUIER venta (cualquier estado) — solo mientras el
// stock no haya salido de bodega todavía (sin outflowBatchId), para no dejar
// un egreso de inventario huérfano apuntando a una venta que ya no existe.
// Ampliado 2026-09-10, pedido de Marcos: el propio asesor también puede
// cancelar SU venta mientras siga PENDING (todavía no la vio Bryan).
// Ampliado 2026-09-17, pedido explícito del usuario: el asesor también puede
// cancelarla ya APROBADA (ej. el cliente no la quiso a último momento),
// siempre que el stock siga sin salir de bodega (sin outflowBatchId, mismo
// candado de abajo) — si ya se entregó al motorizado, ya no es "cancelar",
// es una devolución (ver /return-report, que sí toca Kardex). Si ya fue
// rechazada, solo el admin puede eliminarla (el asesor corrige y reenvía en
// vez de cancelar). Baja lógica, no delete real: el código (VE-000X) queda
// en Historial marcado como eliminado, con fecha, en vez de desaparecer sin
// dejar rastro.
export async function DELETE(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const session = await auth();
  if (!session) return NextResponse.json({ error: "No autorizado." }, { status: 403 });

  const { id } = await params;
  const sale = await prisma.externalSale.findUnique({
    where: { id },
    select: {
      advisorId: true,
      reviewStatus: true,
      outflowBatchId: true,
      deletedAt: true,
      code: true,
      reviewedById: true,
      invoiceUploadedById: true,
      dispatchAssignedToId: true,
      packAssignedToId: true,
      deliveredById: true,
    },
  });
  if (!sale) return NextResponse.json({ error: "No encontrado." }, { status: 404 });

  const isAdmin = session.user.role === "admin";
  const isOwn = sale.advisorId === session.user.id;
  const isOwnAndCancelable = isOwn && (sale.reviewStatus === "PENDING" || sale.reviewStatus === "APPROVED") && !sale.outflowBatchId;
  if (!isAdmin && !isOwnAndCancelable) return NextResponse.json({ error: "No autorizado." }, { status: 403 });

  if (sale.deletedAt) return NextResponse.json({ error: "Ya fue eliminada." }, { status: 409 });
  if (sale.outflowBatchId) return NextResponse.json({ error: "No se puede eliminar: el stock ya salió de bodega para esta venta." }, { status: 409 });

  await prisma.externalSale.update({ where: { id }, data: { deletedAt: new Date(), deletedById: dbUserId(session.user.id) } });

  if (sale.reviewStatus === "APPROVED") {
    await notifyEveryoneExternalSaleCancelled({
      code: sale.code,
      advisorId: sale.advisorId,
      reviewedById: sale.reviewedById,
      invoiceUploadedById: sale.invoiceUploadedById,
      dispatchAssignedToId: sale.dispatchAssignedToId,
      packAssignedToId: sale.packAssignedToId,
      deliveredById: sale.deliveredById,
    });
  }

  return NextResponse.json({ ok: true });
}
