import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { canManageJustCatalog } from "@/lib/guards";
import { WAREHOUSE_AREAS } from "@/lib/warehouseAreas";

const schema = z.object({ area: z.enum(WAREHOUSE_AREAS).nullable() });

// Confirmado 2026-09-26, pedido del usuario: Daniel (o admin) elige o
// cambia en qué área de la bodega (A…G) está cada producto, desde "Stock
// Actual" — mismo permiso que la marca (canManageJustCatalog).
export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  if (!(await canManageJustCatalog())) return NextResponse.json({ error: "No autorizado." }, { status: 403 });

  const { id } = await params;
  const parsed = schema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "Área inválida." }, { status: 400 });

  const item = await prisma.purchaseCatalogItem.findUnique({ where: { id }, select: { id: true } });
  if (!item) return NextResponse.json({ error: "No encontrado." }, { status: 404 });

  const updated = await prisma.purchaseCatalogItem.update({
    where: { id },
    data: { warehouseArea: parsed.data.area },
    select: { id: true, warehouseArea: true },
  });
  return NextResponse.json(updated);
}
