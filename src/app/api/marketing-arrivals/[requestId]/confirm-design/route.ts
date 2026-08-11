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
  const isAdmin = session.user.role === "admin";
  const followUp = await prisma.purchaseReceiptFollowUp.update({
    where: { requestId },
    data: { designConfirmedAt: new Date(), designConfirmedById: isAdmin ? null : session.user.id },
    include: { designConfirmedBy: { select: { name: true } } },
  }).catch(() => null);
  if (!followUp) return NextResponse.json({ error: "No encontrada." }, { status: 404 });

  return NextResponse.json(followUp);
}
