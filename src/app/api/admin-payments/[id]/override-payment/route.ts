import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { auth } from "@/auth";
import { prisma } from "@/lib/prisma";
import { markGroupFreightPaid } from "@/lib/pettyCash";
import { notifyOwner } from "@/lib/notifications";

const schema = z.object({ note: z.string().trim().min(1, "Describe brevemente por qué está bien.") });

// Confirmado 2026-08-12: pedido explícito del usuario — solo admin (el
// único que hace estos pagos) puede dar por buena una transacción cuando el
// comprobante NO coincide con lo declarado (ej. comisión bancaria distinta),
// con un clic + una nota breve. Exclusivo de Pagos administrativos — no
// aplica a Control de Compras ni Caja Chica, que siguen bloqueando sin
// excepción cuando el comprobante no coincide.
export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const session = await auth();
  if (!session || session.user.role !== "admin") return NextResponse.json({ error: "No autorizado." }, { status: 403 });

  const { id } = await params;
  const body = await req.json().catch(() => null);
  const parsed = schema.safeParse(body);
  if (!parsed.success) return NextResponse.json({ error: parsed.error.issues[0]?.message ?? "Datos inválidos." }, { status: 400 });

  const request = await prisma.adminPaymentRequest.findUnique({ where: { id } });
  if (!request) return NextResponse.json({ error: "No encontrada." }, { status: 404 });
  if (request.status !== "PENDING_PAYMENT") return NextResponse.json({ error: "Ya fue pagada." }, { status: 409 });
  if (!request.paymentProofUrl || request.paymentAiMatch !== false) {
    return NextResponse.json({ error: "Esto solo aplica cuando ya hay un comprobante que no coincide." }, { status: 409 });
  }

  const updated = await prisma.adminPaymentRequest.update({
    where: { id },
    data: {
      status: "PAID",
      paidAt: new Date(),
      paidById: null,
      paymentOverrideNote: parsed.data.note,
    },
  });

  if (request.linkedGroupId) {
    await markGroupFreightPaid(request.linkedGroupId, null, request.paymentProofUrl, request.monto);
  }

  if (request.createdById) {
    await notifyOwner(request.createdById, {
      title: "✅ Ya se pagó tu solicitud",
      body: `${request.motivo} — $${request.monto.toFixed(2)} · revisa el comprobante`,
      url: "/area/workspace",
    }).catch(() => null);
  }

  return NextResponse.json(updated);
}
