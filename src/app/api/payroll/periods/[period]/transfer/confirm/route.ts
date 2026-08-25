import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { canEditPayrollRoles, getFinanceLeadId } from "@/lib/guards";
import { isValidPeriod } from "@/lib/payroll";
import { isEndOfMonthQuincena } from "@/lib/payrollCalc";
import { notifyOwner, resolveNotifications } from "@/lib/notifications";

const schema = z.object({ destination: z.enum(["NAIROBY", "ADMIN_PRODUBANCO", "ADMIN_COMPANY"]).optional() });

// Confirmado 2026-08-24: pedido explícito del usuario — el orden real es
// primero pagar, después publicar/entregar el rol (nunca al revés). Nairoby
// envía el total ACÁ, mientras el período sigue en borrador (nunca en uno
// ya publicado) — esto es lo que le avisa al admin cuánto y a qué cuenta
// transferir, mucho antes de que ella publique nada. Reusa este mismo botón
// para reenviar después de un rechazo (recalcula y vuelve a
// PENDING_APPROVAL) — no hay un control de "reenviar" separado.
//
// Reworked mismo día: la cuenta destino dejó de ser 100% automática — ella
// elige entre las 3 (su cuenta, Produbanco de nómina, o la cuenta de la
// empresa) para poder esquivar una que se haya quedado sin fondos. Si no
// manda destination (compatibilidad), se sigue calculando el default de
// siempre según la quincena.
export async function POST(req: NextRequest, { params }: { params: Promise<{ period: string }> }) {
  if (!(await canEditPayrollRoles())) return NextResponse.json({ error: "No autorizado." }, { status: 403 });

  const { period } = await params;
  if (!isValidPeriod(period)) return NextResponse.json({ error: "Período inválido." }, { status: 400 });

  const body = await req.json().catch(() => ({}));
  const parsed = schema.safeParse(body ?? {});
  if (!parsed.success) return NextResponse.json({ error: "Datos inválidos." }, { status: 400 });

  const payrollPeriod = await prisma.payrollPeriod.findUnique({
    where: { period },
    include: { roles: { where: { isCurrent: true } }, transfer: true },
  });
  if (!payrollPeriod) return NextResponse.json({ error: "Primero hay que generar los roles de este período." }, { status: 404 });
  if (payrollPeriod.status !== "DRAFT") return NextResponse.json({ error: "Ya está publicado." }, { status: 409 });
  if (payrollPeriod.transfer && payrollPeriod.transfer.status !== "PENDING_APPROVAL" && payrollPeriod.transfer.status !== "REJECTED") {
    return NextResponse.json({ error: "Ya fue aprobada — no se puede reenviar." }, { status: 409 });
  }

  const destination = parsed.data.destination ?? (isEndOfMonthQuincena(period) ? "ADMIN_PRODUBANCO" : "NAIROBY");

  if (destination === "ADMIN_PRODUBANCO") {
    const acc = await prisma.adminPayrollBankAccount.findUnique({ where: { id: "singleton" } });
    if (!acc?.bankAccountNumber) return NextResponse.json({ error: "La cuenta Produbanco de nómina todavía no está registrada." }, { status: 400 });
  } else if (destination === "ADMIN_COMPANY") {
    const acc = await prisma.companyBankAccount.findUnique({ where: { id: "singleton" } });
    if (!acc?.bankAccountNumber) return NextResponse.json({ error: "La cuenta para recibir transferencias todavía no está registrada." }, { status: 400 });
  } else {
    const financeLeadId = await getFinanceLeadId();
    const acc = financeLeadId ? await prisma.employeeBankAccount.findFirst({ where: { employeeId: financeLeadId, isSelected: true } }) : null;
    if (!acc) return NextResponse.json({ error: "Todavía no registraste tu cuenta bancaria." }, { status: 400 });
  }

  const totalAmount = payrollPeriod.roles.reduce((s, r) => s + r.netTotal, 0);

  const transfer = await prisma.payrollTransfer.upsert({
    where: { periodId: payrollPeriod.id },
    update: { totalAmount, destination, status: "PENDING_APPROVAL", rejectionReason: null, rejectedAt: null },
    create: { periodId: payrollPeriod.id, totalAmount, destination },
  });

  await resolveNotifications("admin", "🔔 Nairoby te envió el total de nómina", `Quincena ${period}`);
  await notifyOwner("admin", {
    title: "🔔 Nairoby te envió el total de nómina",
    body: `Quincena ${period} — $${totalAmount.toFixed(2)} · falta tu aprobación`,
    url: "/admin/nomina?tab=pagos&ptab=roles",
  }).catch(() => null);

  return NextResponse.json(transfer);
}
