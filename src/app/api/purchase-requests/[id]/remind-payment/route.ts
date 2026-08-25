import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { canSubmitPurchaseRequests } from "@/lib/guards";
import { notifyOwner, resolveNotifications } from "@/lib/notifications";

// Botón de un solo clic — no cambia ningún estado, se puede presionar varias
// veces. Confirmado 2026-08-25: además del push en vivo, ahora también
// queda registrado en la campanita (antes solo era push, y se perdía si se
// borraba la notificación del sistema operativo) — resuelve el aviso previo
// del mismo pedido antes de crear uno nuevo para no apilar duplicados si lo
// aprietan varias veces.
export async function POST(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  if (!(await canSubmitPurchaseRequests())) return NextResponse.json({ error: "No autorizado." }, { status: 403 });

  const { id } = await params;
  const request = await prisma.purchaseRequest.findUnique({ where: { id }, select: { status: true, totalCost: true, catalogItem: { select: { name: true } } } });
  if (!request) return NextResponse.json({ error: "No encontrada." }, { status: 404 });
  if (request.status !== "APPROVED") return NextResponse.json({ error: "Ya fue pagada." }, { status: 409 });

  const title = "🔔 Recordatorio de pago pendiente";
  const body = `${request.catalogItem.name} — $${request.totalCost.toFixed(2)}`;
  await resolveNotifications("admin", title, request.catalogItem.name);
  await notifyOwner("admin", { title, body, url: "/admin" }).catch(() => null);

  return NextResponse.json({ ok: true });
}
