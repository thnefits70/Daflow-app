import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/auth";
import { prisma } from "@/lib/prisma";
import { requireAdminSession, getFinanceLeadId } from "@/lib/guards";
import { isValidPeriod } from "@/lib/payroll";
import { notifyOwner, resolveNotifications } from "@/lib/notifications";

// Confirmado 2026-08-23: aprobar es un paso propio, distinto de subir el
// comprobante (ver proof/route.ts) — el admin primero confirma que el total
// y la cuenta destino están bien, y recién después hace la transferencia
// real y sube la prueba.
//
// Pedido de Nairoby 2026-09-30: con COMPANY_DIRECT ("Pagar desde la cuenta
// Pichincha a colaboradores") no hay ninguna transferencia del total — la
// plata ya está en la Pichincha y Nairoby paga a cada colaborador desde ahí.
// El admin igual aprueba el total, y esa aprobación lo deja completado (con
// su nombre y la hora) para que Nairoby siga con los comprobantes
// individuales, sin pedir un comprobante que no existe.
export async function POST(_req: NextRequest, { params }: { params: Promise<{ period: string }> }) {
  if (!(await requireAdminSession())) return NextResponse.json({ error: "No autorizado." }, { status: 403 });
  const session = await auth();

  const { period } = await params;
  if (!isValidPeriod(period)) return NextResponse.json({ error: "Período inválido." }, { status: 400 });

  const payrollPeriod = await prisma.payrollPeriod.findUnique({ where: { period }, include: { transfer: true } });
  if (!payrollPeriod?.transfer) return NextResponse.json({ error: "Todavía no hay una transferencia propuesta para este período." }, { status: 404 });
  if (payrollPeriod.transfer.status !== "PENDING_APPROVAL") {
    return NextResponse.json({ error: "Ya no está pendiente de aprobación." }, { status: 409 });
  }

  const now = new Date();
  const direct = payrollPeriod.transfer.destination === "COMPANY_DIRECT";
  const updated = await prisma.payrollTransfer.update({
    where: { id: payrollPeriod.transfer.id },
    data: direct
      ? {
          status: "COMPLETED",
          approvedAt: now,
          completedAt: now,
          confirmedWithoutProof: true,
          confirmedWithoutProofNote: "Pagado directo desde la cuenta Pichincha a cada colaborador — sin transferir el total.",
          confirmedWithoutProofAt: now,
          confirmedWithoutProofByName: session?.user?.name ?? null,
        }
      : { status: "APPROVED", approvedAt: now },
  });
  await resolveNotifications("admin", "🔔 Nairoby te envió el total de nómina", `Quincena ${period}`);

  if (direct) {
    const financeLeadId = await getFinanceLeadId();
    if (financeLeadId) {
      await notifyOwner(financeLeadId, {
        title: "✅ El admin aprobó pagar la nómina desde Pichincha",
        body: `Quincena ${period} — $${updated.totalAmount.toFixed(2)}. Ya podés pagar a cada colaborador y subir su comprobante.`,
        url: "/area/nomina?tab=pagos&ptab=roles",
      }).catch(() => null);
    }
  }
  return NextResponse.json(updated);
}
