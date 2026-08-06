import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/auth";
import { prisma } from "@/lib/prisma";
import { canManageAdminPayments } from "@/lib/guards";
import { sendPushToOwner } from "@/lib/webPush";

// Botón de un solo clic — no cambia ningún estado, solo dispara UN push al
// admin cada vez que se presiona. No es un interruptor on/off: confirmado
// 2026-08-06, pedido explícito para esta sección Y para Control de Compras
// (ver src/app/api/purchase-requests/[id]/remind-payment/route.ts).
export async function POST(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  if (!(await canManageAdminPayments())) return NextResponse.json({ error: "No autorizado." }, { status: 403 });

  const { id } = await params;
  const request = await prisma.adminPaymentRequest.findUnique({ where: { id } });
  if (!request) return NextResponse.json({ error: "No encontrada." }, { status: 404 });
  if (request.status !== "PENDING_PAYMENT") return NextResponse.json({ error: "Ya fue pagada." }, { status: 409 });

  await sendPushToOwner("admin", {
    title: "🔔 Recordatorio de pago pendiente",
    body: `${request.motivo} — $${request.monto.toFixed(2)}`,
    url: "/admin",
  });

  return NextResponse.json({ ok: true });
}
