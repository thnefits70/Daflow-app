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
  name: z.string().trim().min(1, "Falta el nombre del producto."),
});

export async function POST(req: NextRequest) {
  const canManage = await canManageStockouts();
  if (!canManage) return NextResponse.json({ error: "No autorizado." }, { status: 403 });

  const body = await req.json().catch(() => null);
  const parsed = createSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.issues[0]?.message ?? "Datos inválidos." }, { status: 400 });
  }

  const product = await prisma.stockoutProduct
    .create({ data: { name: parsed.data.name } })
    .catch(() => null);
  if (!product) return NextResponse.json({ error: "Ya existe un producto con ese nombre." }, { status: 409 });

  return NextResponse.json(product, { status: 201 });
}
