import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/auth";
import { prisma } from "@/lib/prisma";
import { canActOnPurchaseReceiving } from "@/lib/guards";

// Confirmado 2026-08-18: pedido explícito del usuario — aprobación final de
// Daniel sobre un cambio de mercadería que ya subió su equipo (ver
// replacement-arrived/route.ts). Recién acá el status pasa a COMPLETED —
// mismo patrón que approve-receipt para la recepción normal.
export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const session = await auth();
  if (!(await canActOnPurchaseReceiving()) || !session) return NextResponse.json({ error: "No autorizado." }, { status: 403 });

  const { id } = await params;
  const resolution = await prisma.purchaseUrgentResolution.findUnique({ where: { id } });
  if (!resolution || resolution.type !== "REPLACEMENT") return NextResponse.json({ error: "No encontrada." }, { status: 404 });
  if (resolution.status !== "PENDING" || !resolution.replacementSubmittedAt) {
    return NextResponse.json({ error: "Todavía no hay una recepción del equipo pendiente de aprobar." }, { status: 409 });
  }

  const isAdmin = session.user.role === "admin";
  const updated = await prisma.purchaseUrgentResolution.update({
    where: { id },
    data: {
      status: "COMPLETED",
      replacementArrivedAt: new Date(),
      replacementVerifiedById: isAdmin ? null : session.user.id,
    },
  });

  return NextResponse.json(updated);
}
