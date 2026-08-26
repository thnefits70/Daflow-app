import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/auth";
import { prisma } from "@/lib/prisma";
import { canEditPayrollRoles } from "@/lib/guards";
import { isValidPeriod, buildAutomaticLineItems, totalsFromLineItems } from "@/lib/payroll";

// Confirmado 2026-08-26: complemento a /generate (que es idempotente y no
// recalcula un período ya existente) — cubre el caso de un colaborador cuyo
// sueldo se configuró en Nómina DESPUÉS de que el período ya se generó.
// Solo mientras el período sigue en DRAFT; una vez PUBLISHED queda
// congelado igual que el resto de los roles.
export async function POST(req: NextRequest, { params }: { params: Promise<{ period: string }> }) {
  if (!(await canEditPayrollRoles())) return NextResponse.json({ error: "No autorizado." }, { status: 403 });

  const { period } = await params;
  if (!isValidPeriod(period)) return NextResponse.json({ error: "Período inválido." }, { status: 400 });

  const { employeeId } = await req.json();
  if (!employeeId || typeof employeeId !== "string") return NextResponse.json({ error: "Falta employeeId." }, { status: 400 });

  const payrollPeriod = await prisma.payrollPeriod.findUnique({ where: { period } });
  if (!payrollPeriod) return NextResponse.json({ error: "Este período todavía no fue generado." }, { status: 400 });
  if (payrollPeriod.status !== "DRAFT") return NextResponse.json({ error: "Este período ya no está en borrador." }, { status: 409 });

  const employee = await prisma.user.findUnique({
    where: { id: employeeId },
    select: { id: true, isActive: true, payrollProfile: { select: { realSalary: true } } },
  });
  if (!employee?.isActive || employee.payrollProfile?.realSalary == null) {
    return NextResponse.json({ error: "Este colaborador no tiene sueldo configurado en Nómina." }, { status: 400 });
  }

  const already = await prisma.payrollQuincenaRole.findFirst({
    where: { periodId: payrollPeriod.id, employeeId, isCurrent: true },
  });
  if (already) return NextResponse.json({ error: "Este colaborador ya tiene un rol en este período." }, { status: 409 });

  const session = await auth();
  const isAdmin = session!.user.role === "admin";
  const lineItems = await buildAutomaticLineItems(employeeId, period);
  const totals = totalsFromLineItems(lineItems);
  const role = await prisma.payrollQuincenaRole.create({
    data: {
      periodId: payrollPeriod.id,
      employeeId,
      createdById: isAdmin ? null : session!.user.id,
      ...totals,
      lineItems: { create: lineItems },
    },
  });

  return NextResponse.json(role, { status: 201 });
}
