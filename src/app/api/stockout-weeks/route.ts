import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { canManageStockouts } from "@/lib/guards";

export async function GET() {
  const canManage = await canManageStockouts();
  if (!canManage) return NextResponse.json({ error: "No autorizado." }, { status: 403 });

  const rows = await prisma.stockoutWeekProduct.findMany({
    include: { product: { select: { id: true, name: true } } },
    orderBy: [{ week: "desc" }, { createdAt: "asc" }],
  });
  return NextResponse.json(rows);
}

const createSchema = z.object({
  week: z.string().regex(/^\d{4}-W\d{2}$/, "Semana inválida."),
  productId: z.string().min(1, "Falta el producto."),
});

export async function POST(req: NextRequest) {
  const canManage = await canManageStockouts();
  if (!canManage) return NextResponse.json({ error: "No autorizado." }, { status: 403 });

  const body = await req.json().catch(() => null);
  const parsed = createSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.issues[0]?.message ?? "Datos inválidos." }, { status: 400 });
  }
  const { week, productId } = parsed.data;

  const row = await prisma.stockoutWeekProduct
    .create({ data: { week, productId }, include: { product: { select: { id: true, name: true } } } })
    .catch(() => null);
  if (!row) return NextResponse.json({ error: "Ese producto ya está marcado para esa semana." }, { status: 409 });

  return NextResponse.json(row, { status: 201 });
}
