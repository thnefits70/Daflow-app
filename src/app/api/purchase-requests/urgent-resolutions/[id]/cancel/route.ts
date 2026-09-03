import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { auth } from "@/auth";
import { prisma } from "@/lib/prisma";

const schema = z.object({ reason: z.string().trim().min(1, "Explica por qué se cancela.") });

// Confirmado 2026-09-03: pedido explícito del usuario — a veces se registra
// la resolución equivocada (ej. Reembolso en vez de Entrega de mercadería
// faltante) y antes no había forma de corregirlo sin tocar la base a mano.
// Solo admin puede cancelar, y solo mientras la resolución no haya tenido
// consecuencias reales todavía (criterio por tipo abajo) — nunca se borra la
// fila, queda como CANCELLED para el respaldo de auditoría. Al cancelar, la
// cantidad vuelve a quedar libre en el reporte (claimedQty ya excluye
// CANCELLED, ver src/lib/purchaseUrgent.ts).
export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const session = await auth();
  if (!session || session.user.role !== "admin") {
    return NextResponse.json({ error: "No autorizado." }, { status: 403 });
  }

  const { id } = await params;
  const body = await req.json().catch(() => null);
  const parsed = schema.safeParse(body);
  if (!parsed.success) return NextResponse.json({ error: parsed.error.issues[0]?.message ?? "Datos inválidos." }, { status: 400 });

  const resolution = await prisma.purchaseUrgentResolution.findUnique({
    where: { id },
    include: { credit: true },
  });
  if (!resolution) return NextResponse.json({ error: "No encontrada." }, { status: 404 });
  if (resolution.status === "CANCELLED") return NextResponse.json({ error: "Ya está cancelada." }, { status: 409 });

  if (resolution.type === "CREDIT") {
    if (!resolution.credit || resolution.credit.status !== "AVAILABLE") {
      return NextResponse.json({ error: "Este crédito ya se usó o ya fue reembolsado, no se puede cancelar." }, { status: 409 });
    }
  } else if (resolution.type === "REPLACEMENT") {
    if (resolution.status !== "PENDING" || resolution.replacementSubmittedAt) {
      return NextResponse.json({ error: "Ya se avanzó este cambio de mercadería, no se puede cancelar." }, { status: 409 });
    }
  } else if (resolution.type === "REFUND") {
    if (resolution.status !== "PENDING") {
      return NextResponse.json({ error: "Ya fue confirmado en el banco, no se puede cancelar." }, { status: 409 });
    }
  }
  // WRITE_OFF no tiene nada externo que deshacer — siempre se puede cancelar.

  const updated = await prisma.$transaction(async (tx) => {
    if (resolution.type === "CREDIT" && resolution.credit) {
      await tx.supplierCredit.update({ where: { id: resolution.credit.id }, data: { status: "CANCELLED" } });
    }
    return tx.purchaseUrgentResolution.update({
      where: { id },
      data: { status: "CANCELLED", cancelledAt: new Date(), cancelledById: session.user.id, cancelReason: parsed.data.reason.trim() },
    });
  });

  return NextResponse.json(updated);
}
