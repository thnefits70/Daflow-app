import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { auth } from "@/auth";
import { canConfirmMarketingAdvisor } from "@/lib/guards";

// Mismo espíritu que confirm-design — doble confirmación en el cliente.
export async function POST(req: NextRequest, { params }: { params: Promise<{ requestId: string }> }) {
  const session = await auth();
  if (!(await canConfirmMarketingAdvisor()) || !session) return NextResponse.json({ error: "No autorizado." }, { status: 403 });

  const { requestId } = await params;
  const isAdmin = session.user.role === "admin";
  const followUp = await prisma.purchaseReceiptFollowUp.update({
    where: { requestId },
    data: { advisorConfirmedAt: new Date(), advisorConfirmedById: isAdmin ? null : session.user.id },
    include: { advisorConfirmedBy: { select: { name: true, marketingAdvisorBrand: true } } },
  }).catch(() => null);
  if (!followUp) return NextResponse.json({ error: "No encontrada." }, { status: 404 });

  return NextResponse.json(followUp);
}
