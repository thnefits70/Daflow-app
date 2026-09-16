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
  // Confirmado 2026-09-16: mismo override que ahora acepta POST
  // /api/external-sales al declarar — la vista previa tiene que calcular
  // exactamente el mismo precio que se va a guardar, así que respeta la
  // misma elección de con/sin recaudo (con la misma restricción: solo
  // tiene efecto si el asesor tiene externalSaleContraEntrega=true).
  isContraEntrega: z.boolean().optional(),
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
  const canOverrideRecaudo = !!advisor?.externalSaleContraEntrega;
  const isContraEntrega = canOverrideRecaudo ? (parsed.data.isContraEntrega ?? true) : false;
  const priced = await priceExternalSaleItems({ isContraEntrega, items: parsed.data.items });
  if (!priced.ok) return NextResponse.json({ error: priced.error }, { status: 400 });

  return NextResponse.json(priced);
}
