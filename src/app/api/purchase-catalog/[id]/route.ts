import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { canSubmitPurchaseRequests, requireAdminSession } from "@/lib/guards";
import { getCatalogItemPriceStats } from "@/lib/purchases";

export async function GET(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  if (!(await canSubmitPurchaseRequests())) return NextResponse.json({ error: "No autorizado." }, { status: 403 });

  const { id } = await params;
  const item = await prisma.purchaseCatalogItem.findUnique({ where: { id } });
  if (!item) return NextResponse.json({ error: "No encontrado." }, { status: 404 });

  const stats = await getCatalogItemPriceStats(id);
  return NextResponse.json({ id: item.id, name: item.name, photos: item.photos, stats });
}

// Confirmado 2026-08-03: eliminar un producto/mercadería/insumo del catálogo
// es SOLO del administrador (nadie más ve esta opción en la UI), y solo si
// nunca tuvo una compra registrada — si tiene historial, se bloquea con un
// mensaje claro en vez de dejar que la restricción de la base de datos
// reviente con un error de llave foránea.
export async function DELETE(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  if (!(await requireAdminSession())) return NextResponse.json({ error: "No autorizado." }, { status: 403 });

  const { id } = await params;
  const item = await prisma.purchaseCatalogItem.findUnique({ where: { id } });
  if (!item) return NextResponse.json({ error: "No encontrado." }, { status: 404 });

  const inUse = await prisma.purchaseRequest.count({ where: { catalogItemId: id } });
  if (inUse > 0) {
    return NextResponse.json(
      { error: "Este producto, mercadería o insumo ya tiene compras registradas — no se puede eliminar sin perder ese historial." },
      { status: 409 }
    );
  }

  await prisma.purchaseCatalogItem.delete({ where: { id } });
  return NextResponse.json({ ok: true });
}
