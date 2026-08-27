import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { canViewPayrollRoles } from "@/lib/guards";
import { isEndOfMonthQuincena, monthOfPeriod, computeMonthlyLegalRole } from "@/lib/payrollCalc";

// Pedido explícito del usuario 2026-08-27: antes de publicar, Nairoby/admin
// quieren ver exactamente la pantalla que le va a aparecer al colaborador
// (el "Rol del mes") sin tener que publicar primero. El MonthlyLegalRole
// real recién se crea en publish/route.ts (mismo momento en que el
// colaborador ya lo puede ver), así que esto NO toca la base de datos —
// solo repite el mismo cálculo (computeMonthlyLegalRole) sobre los datos
// actuales, para previsualizar sin publicar nada.
export async function GET(_req: NextRequest, { params }: { params: Promise<{ roleId: string }> }) {
  if (!(await canViewPayrollRoles())) return NextResponse.json({ error: "No autorizado." }, { status: 403 });

  const { roleId } = await params;
  const role = await prisma.payrollQuincenaRole.findUnique({
    where: { id: roleId },
    include: {
      period: { select: { period: true } },
      employee: {
        select: { name: true, position: true, payrollProfile: { select: { iessDeclaredSalary: true, companyAbsorbsIess: true } } },
      },
    },
  });
  if (!role) return NextResponse.json({ error: "No se encontró este rol." }, { status: 404 });
  if (!isEndOfMonthQuincena(role.period.period)) {
    return NextResponse.json({ error: "La vista previa solo aplica a la quincena de fin de mes — la primera nunca le muestra nada al colaborador." }, { status: 409 });
  }
  const declared = role.employee.payrollProfile?.iessDeclaredSalary;
  if (!declared) {
    return NextResponse.json({ error: "Este colaborador todavía no tiene sueldo declarado configurado en Nómina." }, { status: 409 });
  }

  const legal = computeMonthlyLegalRole(declared, role.employee.payrollProfile?.companyAbsorbsIess ?? false);
  // Mismo criterio que publish/route.ts: el comprobante real solo se
  // previsualiza si coincide con lo que este cálculo declarado da — si el
  // sueldo real pagado es mayor al declarado, la diferencia nunca se
  // muestra acá tampoco.
  const proofMatchesDeclared = role.paidProofUrl && Math.abs(role.netTotal - legal.netTotal) < 0.01;

  return NextResponse.json({
    employeeName: role.employee.name,
    employeePosition: role.employee.position,
    month: monthOfPeriod(role.period.period),
    declaredSalary: legal.declaredSalary,
    iessDeduction: legal.iessDeduction,
    netTotal: legal.netTotal,
    payoutProofUrl: proofMatchesDeclared ? role.paidProofUrl : null,
  });
}
