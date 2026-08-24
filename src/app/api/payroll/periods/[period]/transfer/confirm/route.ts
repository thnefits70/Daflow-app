import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { canEditPayrollRoles } from "@/lib/guards";
import { isValidPeriod } from "@/lib/payroll";
import { isEndOfMonthQuincena } from "@/lib/payrollCalc";
import { notifyOwner } from "@/lib/notifications";

// Confirmado 2026-08-24: pedido explícito del usuario — el orden real es
// primero pagar, después publicar/entregar el rol (nunca al revés). Nairoby
// envía el total ACÁ, mientras el período sigue en borrador (nunca en uno
// ya publicado) — esto es lo que le avisa al admin cuánto y a qué cuenta
// transferir, mucho antes de que ella publique nada. Reusa este mismo botón
// para reenviar después de un rechazo (recalcula y vuelve a
// PENDING_APPROVAL) — no hay un control de "reenviar" separado.
export async function POST(_req: NextRequest, { params }: { params: Promise<{ period: string }> }) {
  if (!(await canEditPayrollRoles())) return NextResponse.json({ error: "No autorizado." }, { status: 403 });

  const { period } = await params;
  if (!isValidPeriod(period)) return NextResponse.json({ error: "Período inválido." }, { status: 400 });

  const payrollPeriod = await prisma.payrollPeriod.findUnique({
    where: { period },
    include: { roles: { where: { isCurrent: true } }, transfer: true },
  });
  if (!payrollPeriod) return NextResponse.json({ error: "Primero hay que generar los roles de este período." }, { status: 404 });
  if (payrollPeriod.status !== "DRAFT") return NextResponse.json({ error: "Ya está publicado." }, { status: 409 });
  if (payrollPeriod.transfer && payrollPeriod.transfer.status !== "PENDING_APPROVAL" && payrollPeriod.transfer.status !== "REJECTED") {
    return NextResponse.json({ error: "Ya fue aprobada — no se puede reenviar." }, { status: 409 });
  }

  const totalAmount = payrollPeriod.roles.reduce((s, r) => s + r.netTotal, 0);
  const destination = isEndOfMonthQuincena(period) ? "ADMIN_PRODUBANCO" : "NAIROBY";

  const transfer = await prisma.payrollTransfer.upsert({
    where: { periodId: payrollPeriod.id },
    update: { totalAmount, destination, status: "PENDING_APPROVAL", rejectionReason: null, rejectedAt: null },
    create: { periodId: payrollPeriod.id, totalAmount, destination },
  });

  await notifyOwner("admin", {
    title: "🔔 Nairoby te envió el total de nómina",
    body: `Quincena ${period} — $${totalAmount.toFixed(2)} · falta tu aprobación`,
    url: "/admin/nomina?tab=pagos&ptab=roles",
  }).catch(() => null);

  return NextResponse.json(transfer);
}
