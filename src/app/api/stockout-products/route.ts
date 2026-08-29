import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { canManageStockouts } from "@/lib/guards";

export async function GET() {
  const canManage = await canManageStockouts();
  if (!canManage) return NextResponse.json({ error: "No autorizado." }, { status: 403 });

  const products = await prisma.stockoutProduct.findMany({ orderBy: { name: "asc" } });
  return NextResponse.json(products);
}

const createSchema = z.object({
  catalogItemId: z.string().trim().min(1, "Falta el producto."),
});

// Confirmado 2026-08-29 (pedido explícito del usuario): ya no se escribe el
// nombre a mano — se elige del catálogo real (ver ProductMatchPicker en
// StockoutPanel). Si ese producto del catálogo ya estaba vinculado a un
// StockoutProduct de antes, se reutiliza esa misma fila en vez de fallar por
// el @unique en catalogItemId — mismo comportamiento de "reutilizar si ya
// existe" que tenía la búsqueda por nombre antes de este cambio.
export async function POST(req: NextRequest) {
  const canManage = await canManageStockouts();
  if (!canManage) return NextResponse.json({ error: "No autorizado." }, { status: 403 });

  const body = await req.json().catch(() => null);
  const parsed = createSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.issues[0]?.message ?? "Datos inválidos." }, { status: 400 });
  }

  const catalogItem = await prisma.purchaseCatalogItem.findUnique({
    where: { id: parsed.data.catalogItemId },
    select: { id: true, name: true },
  });
  if (!catalogItem) return NextResponse.json({ error: "Producto no encontrado en el catálogo." }, { status: 404 });

  const existing = await prisma.stockoutProduct.findUnique({ where: { catalogItemId: catalogItem.id } });
  if (existing) return NextResponse.json(existing);

  const product = await prisma.stockoutProduct
    .create({ data: { name: catalogItem.name, catalogItemId: catalogItem.id } })
    .catch(() => null);
  if (!product) return NextResponse.json({ error: "Ya existe un producto con ese nombre." }, { status: 409 });

  return NextResponse.json(product, { status: 201 });
}
