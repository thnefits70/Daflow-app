import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { auth } from "@/auth";
import { prisma } from "@/lib/prisma";
import { canReviewExternalSales } from "@/lib/guards";
import { notifyAdvisorReviewResult, notifyInventoryLeadExternalSaleApproved } from "@/lib/externalSales";

const schema = z.discriminatedUnion("approved", [
  z.object({ approved: z.literal(true) }),
  z.object({ approved: z.literal(false), rejectionReason: z.string().trim().min(1, "Explica por qué se rechaza.") }),
]);

// Bryan aprueba o rechaza — el rechazo siempre lleva justificación (pedido
// explícito del usuario, "que el admin pueda ver toda esa trazabilidad").
export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const session = await auth();
  if (!(await canReviewExternalSales()) || !session) return NextResponse.json({ error: "No autorizado." }, { status: 403 });

  const { id } = await params;
  const body = await req.json().catch(() => null);
  const parsed = schema.safeParse(body);
  if (!parsed.success) return NextResponse.json({ error: parsed.error.issues[0]?.message ?? "Datos inválidos." }, { status: 400 });

  const sale = await prisma.externalSale.findUnique({
    where: { id },
    select: { reviewStatus: true, advisorId: true, code: true, isContraEntrega: true, items: { select: { rejectedAt: true } } },
  });
  if (!sale) return NextResponse.json({ error: "No encontrado." }, { status: 404 });
  if (sale.reviewStatus !== "PENDING") return NextResponse.json({ error: "Ya fue revisada." }, { status: 409 });
  if (parsed.data.approved && sale.items.some((it) => it.rejectedAt)) {
    return NextResponse.json({ error: "Todavía hay productos rechazados pendientes de corrección." }, { status: 409 });
  }

  const updated = await prisma.externalSale.update({
    where: { id },
    data: parsed.data.approved
      ? { reviewStatus: "APPROVED", reviewedAt: new Date(), reviewedById: session.user.id }
      : { reviewStatus: "REJECTED", reviewedAt: new Date(), reviewedById: session.user.id, rejectionReason: parsed.data.rejectionReason },
  });

  await notifyAdvisorReviewResult(sale.advisorId, sale.code, parsed.data.approved, parsed.data.approved ? null : parsed.data.rejectionReason);
  // Contra entrega (Marcos) pasa a Daniel de una vez; pago anticipado espera
  // a que Nairoby facture primero (ver invoice/route.ts).
  if (parsed.data.approved && sale.isContraEntrega) await notifyInventoryLeadExternalSaleApproved(sale.code);

  return NextResponse.json(updated);
}
