import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { canEditPayrollRoles, getFinanceLeadId } from "@/lib/guards";
import { isValidPeriod } from "@/lib/payroll";
import { notifyOwner, resolveNotifications } from "@/lib/notifications";

const schema = z.object({ destination: z.enum(["NAIROBY", "ADMIN_PRODUBANCO", "ADMIN_COMPANY"]).optional() });

// Confirmado 2026-09-11: pedido explícito del usuario — el "líquido a
// pagar" propio de Nairoby (su rol de colaboradora dentro de esta misma
// quincena) se envía a transferir aparte, con su propio comprobante,
// separado del resto de la nómina (ver PayrollTransfer, que ahora excluye
// este monto de su propio total en su /confirm). Default de cuenta:
// NAIROBY (su propia cuenta), ella la puede cambiar igual que en los otros
// dos sobres.
export async function POST(req: NextRequest, { params }: { params: Promise<{ period: string }> }) {
  if (!(await canEditPayrollRoles())) return NextResponse.json({ error: "No autorizado." }, { status: 403 });

  const { period } = await params;
  if (!isValidPeriod(period)) return NextResponse.json({ error: "Período inválido." }, { status: 400 });

  const body = await req.json().catch(() => ({}));
  const parsed = schema.safeParse(body ?? {});
  if (!parsed.success) return NextResponse.json({ error: "Datos inválidos." }, { status: 400 });

  const financeLeadId = await getFinanceLeadId();
  if (!financeLeadId) return NextResponse.json({ error: "No se encontró a quien lidera Finanzas." }, { status: 404 });

  const payrollPeriod = await prisma.payrollPeriod.findUnique({
    where: { period },
    include: {
      roles: { where: { isCurrent: true, employeeId: financeLeadId } },
      nairobySalaryTransfer: true,
    },
  });
  if (!payrollPeriod) return NextResponse.json({ error: "Primero hay que generar los roles de este período." }, { status: 404 });
  if (payrollPeriod.status !== "DRAFT") return NextResponse.json({ error: "Ya está publicado." }, { status: 409 });
  if (
    payrollPeriod.nairobySalaryTransfer &&
    payrollPeriod.nairobySalaryTransfer.status !== "PENDING_APPROVAL" &&
    payrollPeriod.nairobySalaryTransfer.status !== "REJECTED"
  ) {
    return NextResponse.json({ error: "Ya fue aprobada — no se puede reenviar." }, { status: 409 });
  }

  const ownRole = payrollPeriod.roles[0];
  if (!ownRole) return NextResponse.json({ error: "Todavía no tenés un rol generado en este período." }, { status: 400 });

  const destination = parsed.data.destination ?? "NAIROBY";

  if (destination === "ADMIN_PRODUBANCO") {
    const acc = await prisma.adminPayrollBankAccount.findUnique({ where: { id: "singleton" } });
    if (!acc?.bankAccountNumber) return NextResponse.json({ error: "La cuenta Produbanco de nómina todavía no está registrada." }, { status: 400 });
  } else if (destination === "ADMIN_COMPANY") {
    const acc = await prisma.companyBankAccount.findUnique({ where: { id: "singleton" } });
    if (!acc?.bankAccountNumber) return NextResponse.json({ error: "La cuenta para recibir transferencias todavía no está registrada." }, { status: 400 });
  } else {
    const acc = await prisma.employeeBankAccount.findFirst({ where: { employeeId: financeLeadId, isSelected: true } });
    if (!acc) return NextResponse.json({ error: "Todavía no registraste tu cuenta bancaria." }, { status: 400 });
  }

  const totalAmount = ownRole.netTotal;
  if (totalAmount <= 0) return NextResponse.json({ error: "Tu líquido a pagar en este período es $0 — no hay nada que enviar." }, { status: 400 });

  const transfer = await prisma.payrollNairobySalaryTransfer.upsert({
    where: { periodId: payrollPeriod.id },
    update: { totalAmount, destination, status: "PENDING_APPROVAL", rejectionReason: null, rejectedAt: null },
    create: { periodId: payrollPeriod.id, totalAmount, destination },
  });

  await resolveNotifications("admin", "🔔 Nairoby te envió su sueldo para transferir", `Quincena ${period}`);
  await notifyOwner("admin", {
    title: "🔔 Nairoby te envió su sueldo para transferir",
    body: `Quincena ${period} — $${totalAmount.toFixed(2)} · falta tu aprobación`,
    url: "/admin/nomina?tab=pagos&ptab=roles",
  }).catch(() => null);

  return NextResponse.json(transfer);
}
