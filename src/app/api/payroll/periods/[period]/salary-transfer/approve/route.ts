import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireAdminSession } from "@/lib/guards";
import { isValidPeriod } from "@/lib/payroll";
import { resolveNotifications } from "@/lib/notifications";

export async function POST(_req: NextRequest, { params }: { params: Promise<{ period: string }> }) {
  if (!(await requireAdminSession())) return NextResponse.json({ error: "No autorizado." }, { status: 403 });

  const { period } = await params;
  if (!isValidPeriod(period)) return NextResponse.json({ error: "Período inválido." }, { status: 400 });

  const payrollPeriod = await prisma.payrollPeriod.findUnique({ where: { period }, include: { nairobySalaryTransfer: true } });
  if (!payrollPeriod?.nairobySalaryTransfer) return NextResponse.json({ error: "Todavía no hay un sueldo de Nairoby propuesto para este período." }, { status: 404 });
  if (payrollPeriod.nairobySalaryTransfer.status !== "PENDING_APPROVAL") {
    return NextResponse.json({ error: "Ya no está pendiente de aprobación." }, { status: 409 });
  }

  const updated = await prisma.payrollNairobySalaryTransfer.update({
    where: { id: payrollPeriod.nairobySalaryTransfer.id },
    data: { status: "APPROVED", approvedAt: new Date() },
  });
  await resolveNotifications("admin", "🔔 Nairoby te envió su sueldo para transferir", `Quincena ${period}`);
  return NextResponse.json(updated);
}
