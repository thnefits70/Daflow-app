import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { auth } from "@/auth";
import { canConfirmMarketingDesign } from "@/lib/guards";

// Confirmado 2026-08-08: doble confirmación pedida explícitamente por el
// usuario — el cliente muestra "¿estás seguro?" antes de llamar esta ruta,
// para evitar que alguien confirme sin de verdad haber subido las fotos y
// el video. El servidor solo valida permiso y que no esté ya confirmado.
export async function POST(req: NextRequest, { params }: { params: Promise<{ requestId: string }> }) {
  const session = await auth();
  if (!(await canConfirmMarketingDesign()) || !session) return NextResponse.json({ error: "No autorizado." }, { status: 403 });

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
    update: { designConfirmedAt: new Date(), designConfirmedById: confirmedById },
    create: { requestId, designConfirmedAt: new Date(), designConfirmedById: confirmedById },
    include: { designConfirmedBy: { select: { name: true } } },
  }).catch(() => null);
  if (!followUp) return NextResponse.json({ error: "No se pudo confirmar." }, { status: 500 });

  return NextResponse.json(followUp);
}
