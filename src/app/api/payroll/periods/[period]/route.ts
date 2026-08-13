import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { canViewPayrollRoles } from "@/lib/guards";
import { isValidPeriod } from "@/lib/payroll";
import { isEndOfMonthQuincena, monthOfPeriod } from "@/lib/payrollCalc";

export async function GET(_req: NextRequest, { params }: { params: Promise<{ period: string }> }) {
  if (!(await canViewPayrollRoles())) return NextResponse.json({ error: "No autorizado." }, { status: 403 });

  const { period } = await params;
  if (!isValidPeriod(period)) return NextResponse.json({ error: "Período inválido." }, { status: 400 });

  const record = await prisma.payrollPeriod.findUnique({
    where: { period },
    include: {
      roles: {
        where: { isCurrent: true },
        orderBy: { employee: { name: "asc" } },
        include: { employee: { select: { id: true, name: true, position: true } }, lineItems: true },
      },
    },
  });

  if (!record) return NextResponse.json({ period, status: "NOT_GENERATED", roles: [] });

  // Confirmado 2026-08-13: en la quincena de fin de mes, cada tarjeta
  // también necesita el id del "Rol del mes" vigente de esa persona, para
  // poder corregirlo por separado del rol quincenal interno.
  let monthlyRoleIdByEmployee: Record<string, string> = {};
  if (isEndOfMonthQuincena(period)) {
    const month = monthOfPeriod(period);
    const monthlyRoles = await prisma.monthlyLegalRole.findMany({
      where: { month, isCurrent: true, employeeId: { in: record.roles.map((r) => r.employeeId) } },
      select: { id: true, employeeId: true },
    });
    monthlyRoleIdByEmployee = Object.fromEntries(monthlyRoles.map((m) => [m.employeeId, m.id]));
  }

  return NextResponse.json({ ...record, monthlyRoleIdByEmployee });
}
