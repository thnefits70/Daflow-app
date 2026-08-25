import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/auth";
import { prisma } from "@/lib/prisma";
import { canManageAdminPayments } from "@/lib/guards";
import { notifyOwner, resolveNotifications } from "@/lib/notifications";

// Botón de un solo clic — no cambia ningún estado, se puede presionar varias
// veces. Confirmado 2026-08-25: además del push en vivo, ahora también
// queda registrado en la campanita (antes solo era push, y se perdía si se
// borraba la notificación del sistema operativo) — resuelve el aviso previo
// del mismo pago antes de crear uno nuevo para no apilar duplicados si lo
// aprietan varias veces.
export async function POST(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  if (!(await canManageAdminPayments())) return NextResponse.json({ error: "No autorizado." }, { status: 403 });

  const { id } = await params;
  const request = await prisma.adminPaymentRequest.findUnique({ where: { id } });
  if (!request) return NextResponse.json({ error: "No encontrada." }, { status: 404 });
  if (request.status !== "PENDING_PAYMENT") return NextResponse.json({ error: "Ya fue pagada." }, { status: 409 });

  const title = "🔔 Recordatorio de pago pendiente";
  const body = `${request.motivo} — $${request.monto.toFixed(2)}`;
  await resolveNotifications("admin", title, request.motivo);
  await notifyOwner("admin", { title, body, url: "/admin" }).catch(() => null);

  return NextResponse.json({ ok: true });
}
