import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/auth";
import { prisma } from "@/lib/prisma";
import { requireAdminSession, getFinanceLeadId } from "@/lib/guards";
import { isValidPeriod } from "@/lib/payroll";
import { notifyOwner, resolveNotifications } from "@/lib/notifications";

// Pedido de Nairoby 2026-09-30: con COMPANY_DIRECT ("Pagar desde la cuenta
// Pichincha al IESS") no se transfiere el total a ninguna cuenta — se paga
// al IESS directo desde la Pichincha. El admin igual aprueba, y esa
// aprobación lo deja completado con su nombre y la hora (mismo criterio que
// transfer/approve).
export async function POST(_req: NextRequest, { params }: { params: Promise<{ period: string }> }) {
  if (!(await requireAdminSession())) return NextResponse.json({ error: "No autorizado." }, { status: 403 });
  const session = await auth();

  const { period } = await params;
  if (!isValidPeriod(period)) return NextResponse.json({ error: "Período inválido." }, { status: 400 });

  const payrollPeriod = await prisma.payrollPeriod.findUnique({ where: { period }, include: { iessTransfer: true } });
  if (!payrollPeriod?.iessTransfer) return NextResponse.json({ error: "Todavía no hay una transferencia de IESS propuesta para este período." }, { status: 404 });
  if (payrollPeriod.iessTransfer.status !== "PENDING_APPROVAL") {
    return NextResponse.json({ error: "Ya no está pendiente de aprobación." }, { status: 409 });
  }

  const now = new Date();
  const direct = payrollPeriod.iessTransfer.destination === "COMPANY_DIRECT";
  const updated = await prisma.payrollIessTransfer.update({
    where: { id: payrollPeriod.iessTransfer.id },
    data: direct
      ? {
          status: "COMPLETED",
          approvedAt: now,
          completedAt: now,
          confirmedWithoutProof: true,
          confirmedWithoutProofNote: "Pagado directo desde la cuenta Pichincha al IESS — sin transferir el total.",
          confirmedWithoutProofAt: now,
          confirmedWithoutProofByName: session?.user?.name ?? null,
        }
      : { status: "APPROVED", approvedAt: now },
  });
  await resolveNotifications("admin", "🔔 Nairoby te envió el total de IESS", `Quincena ${period}`);

  if (direct) {
    const financeLeadId = await getFinanceLeadId();
    if (financeLeadId) {
      await notifyOwner(financeLeadId, {
        title: "✅ El admin aprobó pagar el IESS desde Pichincha",
        body: `Quincena ${period} — $${updated.totalAmount.toFixed(2)}.`,
        url: "/area/nomina?tab=pagos&ptab=roles",
      }).catch(() => null);
    }
  }
  return NextResponse.json(updated);
}
