import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { auth } from "@/auth";
import { prisma } from "@/lib/prisma";
import { canConfirmPersonalPurchaseFinance } from "@/lib/guards";

// Catálogo de productos propios de Provedix para compra/retiro personal.
// Confirmado 2026-08-18: el colaborador (y Daniel) puede VER la lista para
// elegir/confirmar, pero JAMÁS los precios — esos solo los ve quien puede
// cerrar el precio final (Nairoby/admin). Solo ellos pueden crear/editar.
export async function GET() {
  const session = await auth();
  if (!session) return NextResponse.json({ error: "No autorizado." }, { status: 401 });

  const canSeePrices = await canConfirmPersonalPurchaseFinance();
  const products = await prisma.retailProduct.findMany({
    orderBy: { name: "asc" },
    select: { id: true, name: true, photo: true, costPrice: canSeePrices, dropiPrice: canSeePrices },
  });
  return NextResponse.json(products);
}

const schema = z.object({
  name: z.string().trim().min(1),
  photo: z.string().optional(),
  costPrice: z.number().nonnegative(),
  dropiPrice: z.number().nonnegative(),
});

export async function POST(req: NextRequest) {
  if (!(await canConfirmPersonalPurchaseFinance())) return NextResponse.json({ error: "No autorizado." }, { status: 403 });

  const session = await auth();
  const body = await req.json().catch(() => null);
  const parsed = schema.safeParse(body);
  if (!parsed.success) return NextResponse.json({ error: parsed.error.issues[0]?.message ?? "Datos inválidos." }, { status: 400 });

  const isAdmin = session!.user.role === "admin";
  const product = await prisma.retailProduct.create({
    data: { ...parsed.data, createdById: isAdmin ? null : session!.user.id },
  });
  return NextResponse.json(product, { status: 201 });
}
