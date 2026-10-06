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
      urgentReports: { where: { rejectedAt: null }, select: { id: true, description: true, _count: { select: { resolutions: true } } } },
    },
  });
  if (!existing || !existing.receipt) return NextResponse.json({ error: "No encontrada." }, { status: 404 });
  if (!["RECEIVED", "RECEIVED_PENDING_REVIEW"].includes(existing.status)) {
    return NextResponse.json({ error: "Esta compra todavía no se recibe." }, { status: 409 });
  }
  // Si ya se abrió el reclamo automático de "Faltante sin reclamar"
  // (short-receipt-claim) y todavía no se coordinó nada con el proveedor, se
  // anula junto con la corrección (caso SC-008: se pulsó el botón rojo).
  // Cualquier otro reclamo sigue su camino normal.
  const autoClaimIds = existing.urgentReports.filter((r) => r.description?.startsWith("Faltante sin reclamar") && r._count.resolutions === 0).map((r) => r.id);
  if (autoClaimIds.length !== existing.urgentReports.length) {
    return NextResponse.json({ error: "Esta compra ya tiene un reclamo en curso con el proveedor; resuélvelo desde ahí." }, { status: 409 });
  }
  if (existing.receipt.receivedQuantity >= existing.quantity) {
    return NextResponse.json({ error: "Ya figura como recibida completa." }, { status: 409 });
  }

  const now = new Date();
  const [updated] = await prisma.$transaction([
    prisma.purchaseRequestReceipt.update({
      where: { requestId: id },
      data: {
        receivedQuantity: existing.quantity,
        originalReceivedQuantity: existing.receipt.originalReceivedQuantity ?? existing.receipt.receivedQuantity,
        quantityCorrectedById: null,
        quantityCorrectedAt: now,
        quantityCorrectionNote: parsed.data.note,
      },
    }),
    prisma.purchaseRequestUrgentReport.updateMany({
      where: { id: { in: autoClaimIds } },
      data: { rejectedAt: now, rejectedById: null, rejectionReason: `Sí llegó completo: ${parsed.data.note}` },
    }),
  ]);

  return NextResponse.json(updated);
}
