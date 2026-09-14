import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { auth } from "@/auth";
import { prisma } from "@/lib/prisma";
import { canDeclareExternalSales } from "@/lib/guards";
import { priceExternalSaleItems } from "@/lib/externalSales";

const schema = z.object({
  items: z.array(
    z.object({
      catalogItemId: z.string().min(1),
      quantity: z.number().int().positive(),
      marginPercent: z.number().optional(),
    })
  ),
});

// Confirmado 2026-09-14: vista previa en vivo del precio mientras el asesor
// arma el carrito en ExternalSaleDeclareForm — nunca es lo que se guarda de
// verdad (POST/PATCH recalculan otra vez, server-side, al enviar).
export async function POST(req: NextRequest) {
  const session = await auth();
  if (!(await canDeclareExternalSales()) || !session) return NextResponse.json({ error: "No autorizado." }, { status: 403 });

  const body = await req.json().catch(() => null);
  const parsed = schema.safeParse(body);
  if (!parsed.success) return NextResponse.json({ error: parsed.error.issues[0]?.message ?? "Datos inválidos." }, { status: 400 });
  if (parsed.data.items.length === 0) return NextResponse.json({ items: [] });

  const advisor = await prisma.user.findUnique({ where: { id: session.user.id }, select: { externalSaleContraEntrega: true } });
  const priced = await priceExternalSaleItems({ isContraEntrega: !!advisor?.externalSaleContraEntrega, items: parsed.data.items });
  if (!priced.ok) return NextResponse.json({ error: priced.error }, { status: 400 });

  return NextResponse.json(priced);
}
