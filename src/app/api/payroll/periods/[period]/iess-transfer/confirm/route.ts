import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { canEditPayrollRoles, getFinanceLeadId } from "@/lib/guards";
import { isValidPeriod, totalIessOwedFromRoles } from "@/lib/payroll";
import { notifyOwner, resolveNotifications } from "@/lib/notifications";

const schema = z.object({ destination: z.enum(["NAIROBY", "ADMIN_PRODUBANCO", "ADMIN_COMPANY"]).optional() });

// Mismo patrón que /transfer/confirm/route.ts, pero para el total aparte de
// IESS (ver totalIessFromRoles) — reusa el mismo botón para reenviar
// después de un rechazo. Default de cuenta: ADMIN_COMPANY (Pichincha
// 0970), confirmado con el usuario 2026-08-26.
export async function POST(req: NextRequest, { params }: { params: Promise<{ period: string }> }) {
  if (!(await canEditPayrollRoles())) return NextResponse.json({ error: "No autorizado." }, { status: 403 });

  const { period } = await params;
  if (!isValidPeriod(period)) return NextResponse.json({ error: "Período inválido." }, { status: 400 });

  const body = await req.json().catch(() => ({}));
  const parsed = schema.safeParse(body ?? {});
  if (!parsed.success) return NextResponse.json({ error: "Datos inválidos." }, { status: 400 });

  const payrollPeriod = await prisma.payrollPeriod.findUnique({
    where: { period },
    include: {
      roles: {
        where: { isCurrent: true },
        include: { employee: { select: { name: true, payrollProfile: { select: { iessDeclaredSalary: true, companyAbsorbsIess: true, iessPartTime: true } } } } },
      },
      iessTransfer: true,
    },
  });
  if (!payrollPeriod) return NextResponse.json({ error: "Primero hay que generar los roles de este período." }, { status: 404 });
  if (payrollPeriod.status !== "DRAFT") return NextResponse.json({ error: "Ya está publicado." }, { status: 409 });
  if (payrollPeriod.iessTransfer && payrollPeriod.iessTransfer.status !== "PENDING_APPROVAL" && payrollPeriod.iessTransfer.status !== "REJECTED") {
    return NextResponse.json({ error: "Ya fue aprobada — no se puede reenviar." }, { status: 409 });
  }

  const destination = parsed.data.destination ?? "ADMIN_COMPANY";

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

  const totalAmount = totalIessOwedFromRoles(payrollPeriod.roles);
  if (totalAmount <= 0) return NextResponse.json({ error: "No hay IESS que pagar en este período todavía." }, { status: 400 });

  const transfer = await prisma.payrollIessTransfer.upsert({
    where: { periodId: payrollPeriod.id },
    update: { totalAmount, destination, status: "PENDING_APPROVAL", rejectionReason: null, rejectedAt: null },
    create: { periodId: payrollPeriod.id, totalAmount, destination },
  });

  await resolveNotifications("admin", "🔔 Nairoby te envió el total de IESS", `Quincena ${period}`);
  await notifyOwner("admin", {
    title: "🔔 Nairoby te envió el total de IESS",
    body: `Quincena ${period} — $${totalAmount.toFixed(2)} · falta tu aprobación`,
    url: "/admin/nomina?tab=pagos&ptab=roles",
  }).catch(() => null);

  return NextResponse.json(transfer);
}
