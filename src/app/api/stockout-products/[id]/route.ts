import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { canManageStockouts } from "@/lib/guards";

const updateSchema = z.object({
  name: z.string().trim().min(1, "Falta el nombre del producto."),
});

// Renaming the catalog entry (not a per-week attachment) so a typo like
// "PRIDUCTO 8" gets corrected everywhere it's already been used, instead of
// requiring delete-and-recreate across every week it appears in.
export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const canManage = await canManageStockouts();
  if (!canManage) return NextResponse.json({ error: "No autorizado." }, { status: 403 });

  const { id } = await params;
  const body = await req.json().catch(() => null);
  const parsed = updateSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.issues[0]?.message ?? "Datos inválidos." }, { status: 400 });
  }

  const product = await prisma.stockoutProduct
    .update({ where: { id }, data: { name: parsed.data.name } })
    .catch(() => null);
  if (!product) return NextResponse.json({ error: "No se pudo renombrar. ¿Ya existe otro producto con ese nombre?" }, { status: 409 });

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
