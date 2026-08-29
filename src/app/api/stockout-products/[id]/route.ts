import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { canManageStockouts } from "@/lib/guards";

const updateSchema = z.object({
  catalogItemId: z.string().trim().min(1, "Falta el producto."),
});

// Confirmado 2026-08-29 (pedido explícito del usuario): ya no se corrige el
// nombre escribiéndolo a mano — se re-vincula a otro producto del catálogo
// real (mismo picker que al agregar), para que quede corregido en todas las
// semanas donde ya aparece sin depender de que alguien lo escriba igual.
export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const canManage = await canManageStockouts();
  if (!canManage) return NextResponse.json({ error: "No autorizado." }, { status: 403 });

  const { id } = await params;
  const body = await req.json().catch(() => null);
  const parsed = updateSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.issues[0]?.message ?? "Datos inválidos." }, { status: 400 });
  }

  const catalogItem = await prisma.purchaseCatalogItem.findUnique({
    where: { id: parsed.data.catalogItemId },
    select: { id: true, name: true },
  });
  if (!catalogItem) return NextResponse.json({ error: "Producto no encontrado en el catálogo." }, { status: 404 });

  const product = await prisma.stockoutProduct
    .update({ where: { id }, data: { name: catalogItem.name, catalogItemId: catalogItem.id } })
    .catch(() => null);
  if (!product) return NextResponse.json({ error: "No se pudo vincular. Ese producto del catálogo ya está en uso por otra fila." }, { status: 409 });

  return NextResponse.json(product);
}

// Permanently removes a catalog entry — but only if it has zero history.
// The relation is onDelete: Cascade at the DB level, so this check (not the
// FK) is what actually prevents silently wiping real week attachments.
export async function DELETE(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const canManage = await canManageStockouts();
  if (!canManage) return NextResponse.json({ error: "No autorizado." }, { status: 403 });

  const { id } = await params;
  const usageCount = await prisma.stockoutWeekProduct.count({ where: { productId: id } });
  if (usageCount > 0) {
    return NextResponse.json(
      { error: "No se puede eliminar: tiene historial guardado en semanas. Borra ese historial primero." },
      { status: 409 }
    );
  }

  await prisma.stockoutProduct.delete({ where: { id } }).catch(() => null);
  return NextResponse.json({ ok: true });
}
