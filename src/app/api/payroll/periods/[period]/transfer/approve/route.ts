import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireAdminSession } from "@/lib/guards";
import { isValidPeriod } from "@/lib/payroll";
import { resolveNotifications } from "@/lib/notifications";

// Confirmado 2026-08-23: aprobar es un paso propio, distinto de subir el
// comprobante (ver proof/route.ts) — el admin primero confirma que el total
// y la cuenta destino están bien, y recién después hace la transferencia
// real y sube la prueba.
export async function POST(_req: NextRequest, { params }: { params: Promise<{ period: string }> }) {
  if (!(await requireAdminSession())) return NextResponse.json({ error: "No autorizado." }, { status: 403 });

  const { period } = await params;
  if (!isValidPeriod(period)) return NextResponse.json({ error: "Período inválido." }, { status: 400 });

  const payrollPeriod = await prisma.payrollPeriod.findUnique({ where: { period }, include: { transfer: true } });
  if (!payrollPeriod?.transfer) return NextResponse.json({ error: "Todavía no hay una transferencia propuesta para este período." }, { status: 404 });
  if (payrollPeriod.transfer.status !== "PENDING_APPROVAL") {
    return NextResponse.json({ error: "Ya no está pendiente de aprobación." }, { status: 409 });
  }

  const updated = await prisma.payrollTransfer.update({
    where: { id: payrollPeriod.transfer.id },
    data: { status: "APPROVED", approvedAt: new Date() },
  });
  await resolveNotifications("admin", "🔔 Nairoby te envió el total de nómina", `Quincena ${period}`);
  return NextResponse.json(updated);
}
