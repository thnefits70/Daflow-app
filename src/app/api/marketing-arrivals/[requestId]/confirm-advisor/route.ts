import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { auth } from "@/auth";
import { canConfirmMarketingAdvisor } from "@/lib/guards";

// Mismo espíritu que confirm-design — doble confirmación en el cliente.
export async function POST(req: NextRequest, { params }: { params: Promise<{ requestId: string }> }) {
  const session = await auth();
  if (!(await canConfirmMarketingAdvisor()) || !session) return NextResponse.json({ error: "No autorizado." }, { status: 403 });

  const { requestId } = await params;
  const existing = await prisma.purchaseRequest.findUnique({ where: { id: requestId }, select: { id: true } });
  if (!existing) return NextResponse.json({ error: "No encontrada." }, { status: 404 });

  const isAdmin = session.user.role === "admin";
  const confirmedById = isAdmin ? null : session.user.id;
  // Fix confirmado 2026-08-18: pedidos recibidos ANTES de que existiera esta
  // función (2026-08-08) nunca tuvieron su fila PurchaseReceiptFollowUp
  // creada — el .update de antes fallaba en silencio para esos y el botón
  // se quedaba "pendiente" para siempre. upsert la crea si falta.
  const followUp = await prisma.purchaseReceiptFollowUp.upsert({
    where: { requestId },
    update: { advisorConfirmedAt: new Date(), advisorConfirmedById: confirmedById },
    create: { requestId, advisorConfirmedAt: new Date(), advisorConfirmedById: confirmedById },
    include: { advisorConfirmedBy: { select: { name: true, marketingAdvisorBrand: true } } },
  }).catch(() => null);
  if (!followUp) return NextResponse.json({ error: "No se pudo confirmar." }, { status: 500 });

  return NextResponse.json(followUp);
}
