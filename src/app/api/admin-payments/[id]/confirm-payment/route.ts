import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/auth";
import { prisma } from "@/lib/prisma";
import { markGroupFreightPaid } from "@/lib/pettyCash";
import { notifyOwner } from "@/lib/notifications";

// Confirmado 2026-09-16: pedido explícito del usuario — subir el comprobante
// ya no pasa la solicitud a PAID solo porque la IA dijo que coincide. El
// admin tiene que revisar y dar el visto bueno final acá; el botón en la UI
// está bloqueado hasta que paymentAiMatch sea true.
export async function POST(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const session = await auth();
  if (!session || session.user.role !== "admin") return NextResponse.json({ error: "No autorizado." }, { status: 403 });

  const { id } = await params;
  const request = await prisma.adminPaymentRequest.findUnique({
    where: { id },
    include: { lunchWeekSubmission: { select: { verifiedById: true } } },
  });
  if (!request) return NextResponse.json({ error: "No encontrada." }, { status: 404 });
  if (request.status !== "PENDING_PAYMENT") return NextResponse.json({ error: "Ya fue pagada." }, { status: 409 });
  if (request.paymentAiMatch !== true) return NextResponse.json({ error: "El comprobante todavía no coincide con lo solicitado." }, { status: 409 });

  const updated = await prisma.adminPaymentRequest.update({
    where: { id },
    data: { status: "PAID", paidAt: new Date(), paidById: null },
  });

  if (request.linkedGroupId && request.paymentProofUrl) {
    await markGroupFreightPaid(request.linkedGroupId, null, request.paymentProofUrl, request.monto);
  }

  if (request.createdById) {
    await notifyOwner(request.createdById, {
      title: "✅ Ya se pagó tu solicitud",
      body: `${request.motivo} — $${request.monto.toFixed(2)} · revisa el comprobante`,
      url: "/area/workspace",
    }).catch(() => null);
  }

  // Confirmado 2026-09-08: pedido explícito del usuario — Nairoby (quien
  // verificó la semana de almuerzos) debe enterarse cuando ya se pagó, para
  // su registro de auditorías futuras, aunque no sea ella quien la registró.
  if (request.lunchWeekSubmission?.verifiedById) {
    await notifyOwner(request.lunchWeekSubmission.verifiedById, {
      title: "✅ Ya se pagó — Almuerzos",
      body: `${request.motivo} — $${request.monto.toFixed(2)} · revisa el comprobante`,
      url: "/area/workspace",
    }).catch(() => null);
  }

  return NextResponse.json(updated);
}
