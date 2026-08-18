import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { auth } from "@/auth";
import { canActOnPurchaseReceiving } from "@/lib/guards";

// Confirmado 2026-08-18: pedido explícito del usuario — checklist personal
// de Daniel, independiente de la aprobación (approve-receipt/route.ts). Una
// recepción puede llevar rato en RECEIVED y seguir sin subirse a Just.
export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const session = await auth();
  if (!(await canActOnPurchaseReceiving()) || !session) return NextResponse.json({ error: "No autorizado." }, { status: 403 });

  const { id } = await params;
  const existing = await prisma.purchaseRequest.findUnique({ where: { id }, include: { receipt: true } });
  if (!existing?.receipt) return NextResponse.json({ error: "No encontrada." }, { status: 404 });
  if (existing.status !== "RECEIVED") return NextResponse.json({ error: "Todavía no está aprobada." }, { status: 409 });
  if (existing.receipt.justaUploadedAt) return NextResponse.json({ error: "Ya estaba marcada como subida." }, { status: 409 });

  const isAdmin = session.user.role === "admin";
  const updated = await prisma.purchaseRequestReceipt.update({
    where: { requestId: id },
    data: { justaUploadedById: isAdmin ? null : session.user.id, justaUploadedAt: new Date() },
  });

  return NextResponse.json(updated);
}
