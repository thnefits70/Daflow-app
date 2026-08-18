import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { canConfirmPersonalPurchaseFinance } from "@/lib/guards";

const schema = z.object({
  name: z.string().trim().min(1).optional(),
  photo: z.string().optional(),
  costPrice: z.number().nonnegative().optional(),
  dropiPrice: z.number().nonnegative().optional(),
});

// Confirmado 2026-08-18: pedido explícito del usuario — los precios pueden
// cambiar de a poco, así que Nairoby/admin necesita poder editarlos
// después, no solo al crear el producto.
export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  if (!(await canConfirmPersonalPurchaseFinance())) return NextResponse.json({ error: "No autorizado." }, { status: 403 });

  const { id } = await params;
  const body = await req.json().catch(() => null);
  const parsed = schema.safeParse(body);
  if (!parsed.success) return NextResponse.json({ error: parsed.error.issues[0]?.message ?? "Datos inválidos." }, { status: 400 });

  const product = await prisma.retailProduct.update({ where: { id }, data: parsed.data });
  return NextResponse.json(product);
}
