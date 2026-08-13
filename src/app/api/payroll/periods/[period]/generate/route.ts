import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/auth";
import { prisma } from "@/lib/prisma";
import { canEditPayrollRoles } from "@/lib/guards";
import { isValidPeriod, buildAutomaticLineItems, totalsFromLineItems } from "@/lib/payroll";

// Confirmado 2026-08-13: "Generar roles" es idempotente a propósito — si el
// período ya existe (borrador o publicado), no vuelve a recalcular nada
// (para no pisar conceptos que Nairoby ya haya agregado a mano). Solo crea
// desde cero la primera vez que se hace clic para ese período.
export async function POST(_req: NextRequest, { params }: { params: Promise<{ period: string }> }) {
  if (!(await canEditPayrollRoles())) return NextResponse.json({ error: "No autorizado." }, { status: 403 });

  const session = await auth();
  const { period } = await params;
  if (!isValidPeriod(period)) return NextResponse.json({ error: "Período inválido." }, { status: 400 });

  const existing = await prisma.payrollPeriod.findUnique({ where: { period } });
  if (existing) {
    return NextResponse.json({ error: "Este período ya fue generado." }, { status: 409 });
  }

  const employees = await prisma.user.findMany({
    where: { isActive: true, payrollProfile: { realSalary: { not: null } } },
    select: { id: true },
  });
  if (employees.length === 0) {
    return NextResponse.json({ error: "Ningún colaborador tiene sueldo configurado todavía en Nómina." }, { status: 400 });
  }

  const isAdmin = session!.user.role === "admin";
  const payrollPeriod = await prisma.payrollPeriod.create({
    data: { period, status: "DRAFT", generatedAt: new Date(), generatedById: isAdmin ? null : session!.user.id },
  });

  for (const emp of employees) {
    const lineItems = await buildAutomaticLineItems(emp.id, period);
    const totals = totalsFromLineItems(lineItems);
    await prisma.payrollQuincenaRole.create({
      data: {
        periodId: payrollPeriod.id,
        employeeId: emp.id,
        createdById: isAdmin ? null : session!.user.id,
        ...totals,
        lineItems: { create: lineItems },
      },
    });
  }

  const full = await prisma.payrollPeriod.findUnique({
    where: { id: payrollPeriod.id },
    include: {
      roles: { where: { isCurrent: true }, include: { employee: { select: { id: true, name: true, position: true } }, lineItems: true } },
    },
  });
  return NextResponse.json(full, { status: 201 });
}
