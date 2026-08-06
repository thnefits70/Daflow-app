import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { canSubmitPurchaseRequests } from "@/lib/guards";
import { sendPushToOwner } from "@/lib/webPush";

// Botón de un solo clic — no cambia ningún estado, solo dispara UN push al
// admin cada vez que se presiona. No es un interruptor on/off: confirmado
// 2026-08-06, pedido explícito también para Pagos administrativos (ver
// src/app/api/admin-payments/[id]/remind-payment/route.ts).
export async function POST(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  if (!(await canSubmitPurchaseRequests())) return NextResponse.json({ error: "No autorizado." }, { status: 403 });

  const { id } = await params;
  const request = await prisma.purchaseRequest.findUnique({ where: { id }, select: { status: true, totalCost: true, catalogItem: { select: { name: true } } } });
  if (!request) return NextResponse.json({ error: "No encontrada." }, { status: 404 });
  if (request.status !== "APPROVED") return NextResponse.json({ error: "Ya fue pagada." }, { status: 409 });

  await sendPushToOwner("admin", {
    title: "🔔 Recordatorio de pago pendiente",
    body: `${request.catalogItem.name} — $${request.totalCost.toFixed(2)}`,
    url: "/admin",
  });

  return NextResponse.json({ ok: true });
}
