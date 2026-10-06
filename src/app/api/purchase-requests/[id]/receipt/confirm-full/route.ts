import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { auth } from "@/auth";

const schema = z.object({
  note: z.string().trim().min(1, "Explica cómo se confirmó que llegó todo."),
});

// Pedido del usuario 2026-10-06 (caso Bolsa De Lavar Zapatos SC-008, 12 ago):
// el equipo anotó 270 de 300, pero el admin volvió a contar con ellos y sí
// llegaron las 300. Desde "Faltantes que nunca se reclamaron", el admin
// corrige la recepción a lo pedido sin abrir reclamo. Solo corrige el
// registro de la compra — NO toca el Kardex ni el stock (eso lo ajusta el
// conteo físico). Guarda lo primero que contó el equipo en
// originalReceivedQuantity, igual que correct-quantity.
export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const session = await auth();
  if (!session || session.user.role !== "admin") return NextResponse.json({ error: "Solo el admin puede confirmar esto." }, { status: 403 });

  const { id } = await params;
  const parsed = schema.safeParse(await req.json().catch(() => ({})));
  if (!parsed.success) return NextResponse.json({ error: parsed.error.issues[0]?.message ?? "Datos inválidos." }, { status: 400 });

  const existing = await prisma.purchaseRequest.findUnique({
    where: { id },
    select: {
      quantity: true,
      status: true,
      receipt: { select: { receivedQuantity: true, originalReceivedQuantity: true } },
      _count: { select: { urgentReports: true } },
    },
  });
  if (!existing || !existing.receipt) return NextResponse.json({ error: "No encontrada." }, { status: 404 });
  if (!["RECEIVED", "RECEIVED_PENDING_REVIEW"].includes(existing.status)) {
    return NextResponse.json({ error: "Esta compra todavía no se recibe." }, { status: 409 });
  }
  if (existing._count.urgentReports > 0) {
    return NextResponse.json({ error: "Esta compra ya tiene un reclamo abierto; resuélvelo desde ahí." }, { status: 409 });
  }
  if (existing.receipt.receivedQuantity >= existing.quantity) {
    return NextResponse.json({ error: "Ya figura como recibida completa." }, { status: 409 });
  }

  const updated = await prisma.purchaseRequestReceipt.update({
    where: { requestId: id },
    data: {
      receivedQuantity: existing.quantity,
      originalReceivedQuantity: existing.receipt.originalReceivedQuantity ?? existing.receipt.receivedQuantity,
      quantityCorrectedById: null,
      quantityCorrectedAt: new Date(),
      quantityCorrectionNote: parsed.data.note,
    },
  });

  return NextResponse.json(updated);
}
