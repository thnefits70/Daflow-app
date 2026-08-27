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
        include: {
          employee: {
            select: {
              id: true,
              name: true,
              position: true,
              employeeBankAccounts: {
                where: { isSelected: true },
                select: { bankName: true, bankAccountType: true, bankAccountNumber: true, bankAccountHolder: true, holderIdType: true, holderIdNumber: true },
                take: 1,
              },
              payrollProfile: { select: { iessDeclaredSalary: true, companyAbsorbsIess: true, iessPartTime: true } },
            },
          },
          lineItems: true,
        },
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

  // Confirmado 2026-08-26: bug real encontrado por el usuario — "Generar
  // roles" es idempotente (no recalcula un período ya existente), así que
  // un colaborador a quien recién se le configura sueldo en Nómina DESPUÉS
  // de que el período ya se generó se queda sin rol para siempre, sin
  // ninguna señal de que falta. Mientras el período siga en DRAFT, se lista
  // aparte para que Nairoby/admin puedan sumarlo con un clic.
  let missingEmployees: { id: string; name: string; position: string | null }[] = [];
  if (record.status === "DRAFT") {
    const existingIds = new Set(record.roles.map((r) => r.employeeId));
    const configured = await prisma.user.findMany({
      where: { isActive: true, payrollProfile: { realSalary: { not: null } } },
      select: { id: true, name: true, position: true },
      orderBy: { name: "asc" },
    });
    missingEmployees = configured.filter((u) => !existingIds.has(u.id));
  }

  return NextResponse.json({ ...record, monthlyRoleIdByEmployee, missingEmployees });
}
