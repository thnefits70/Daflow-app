import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { auth } from "@/auth";

// Pedido del usuario 2026-10-03: quien propuso marca "Enterado" de su
// propuesta rechazada — deja de salirle en Inicio (getMarketProposerPendingItems).
export async function POST(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const session = await auth();
  if (!session) return NextResponse.json({ error: "No autorizado." }, { status: 403 });

  const { id } = await params;
  const p = await prisma.marketProductProposal.findUnique({ where: { id }, select: { status: true, proposedById: true } });
  if (!p) return NextResponse.json({ error: "No encontrada." }, { status: 404 });
  if (p.status !== "REJECTED") return NextResponse.json({ error: "No está rechazada." }, { status: 409 });
  if (p.proposedById !== session.user.id) return NextResponse.json({ error: "Solo quien la propuso." }, { status: 403 });

  await prisma.marketProductProposal.update({ where: { id }, data: { rejectionSeenAt: new Date() } });
  return NextResponse.json({ ok: true });
}
