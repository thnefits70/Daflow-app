import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { auth } from "@/auth";
import { canActOnPurchaseReceiving } from "@/lib/guards";

// Confirmado 2026-08-18: mismo checklist de Just que
// [id]/mark-justa-uploaded, pero para cambios de mercadería (reemplazos) ya
// aprobados por Daniel.
export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const session = await auth();
  if (!(await canActOnPurchaseReceiving()) || !session) return NextResponse.json({ error: "No autorizado." }, { status: 403 });

  const { id } = await params;
  const existing = await prisma.purchaseUrgentResolution.findUnique({ where: { id } });
  if (!existing || existing.type !== "REPLACEMENT") return NextResponse.json({ error: "No encontrada." }, { status: 404 });
  if (existing.status !== "COMPLETED") return NextResponse.json({ error: "Todavía no está aprobada." }, { status: 409 });
  if (existing.justaUploadedAt) return NextResponse.json({ error: "Ya estaba marcada como subida." }, { status: 409 });

  const isAdmin = session.user.role === "admin";
  const updated = await prisma.purchaseUrgentResolution.update({
    where: { id },
    data: { justaUploadedById: isAdmin ? null : session.user.id, justaUploadedAt: new Date() },
  });

  return NextResponse.json(updated);
}
