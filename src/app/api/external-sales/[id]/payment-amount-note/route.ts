import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { auth } from "@/auth";
import { prisma } from "@/lib/prisma";
import { canDeclareExternalSales } from "@/lib/guards";

const schema = z.object({ note: z.string().trim().min(3, "Explica brevemente por qué está bien.") });

// Confirmado 2026-09-18, pedido explícito del usuario: cuando el comprobante
// no coincide con lo que se esperaba (la IA lo marcó, ver
// paymentProofAiMatches), el ASESOR dueño de la venta es quien sabe por qué
// (ej. el cliente transfirió de más/de menos por error) — acá lo explica,
// para que el botón "Confirmar recibido" de admin se desbloquee. Admin
// también puede escribirlo él mismo como respaldo si el asesor no está
// disponible.
export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const session = await auth();
  if (!(await canDeclareExternalSales()) || !session) return NextResponse.json({ error: "No autorizado." }, { status: 403 });

  const { id } = await params;
  const body = await req.json().catch(() => null);
  const parsed = schema.safeParse(body);
  if (!parsed.success) return NextResponse.json({ error: parsed.error.issues[0]?.message ?? "Datos inválidos." }, { status: 400 });

  const sale = await prisma.externalSale.findUnique({
    where: { id },
    select: { advisorId: true, paymentProofUrl: true, paymentProofAiMatches: true, paymentConfirmedAt: true, deletedAt: true },
  });
  if (!sale || sale.deletedAt) return NextResponse.json({ error: "No encontrado." }, { status: 404 });
  if (sale.advisorId !== session.user.id && session.user.role !== "admin") return NextResponse.json({ error: "No autorizado." }, { status: 403 });
  if (!sale.paymentProofUrl) return NextResponse.json({ error: "Todavía no hay comprobante subido." }, { status: 409 });
  if (sale.paymentProofAiMatches === true) return NextResponse.json({ error: "El monto ya coincide — no hace falta ninguna explicación." }, { status: 409 });
  if (sale.paymentConfirmedAt) return NextResponse.json({ error: "Esta venta ya fue confirmada." }, { status: 409 });

  const updated = await prisma.externalSale.update({
    where: { id },
    data: {
      paymentOverrideNote: parsed.data.note,
      paymentOverrideAt: new Date(),
      paymentOverrideById: session.user.role === "admin" ? null : session.user.id,
    },
  });

  return NextResponse.json(updated);
}
