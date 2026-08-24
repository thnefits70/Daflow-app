import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/auth";
import { prisma } from "@/lib/prisma";
import { canEditPayrollRoles } from "@/lib/guards";
import { isValidPeriod } from "@/lib/payroll";
import { isEndOfMonthQuincena, monthOfPeriod, computeMonthlyLegalRole } from "@/lib/payrollCalc";
import { notifyOwner } from "@/lib/notifications";
import { actorName } from "@/lib/actorName";

// Confirmado 2026-08-13: pedido explícito del usuario — al publicar la
// quincena de fin de mes, se genera de una el "Rol del mes" (MonthlyLegalRole)
// que sí ve cada colaborador, calculado sobre su sueldo declarado — nunca
// sobre lo que se ve acá. El detalle real queda solo en PayrollQuincenaRole.
export async function POST(_req: NextRequest, { params }: { params: Promise<{ period: string }> }) {
  if (!(await canEditPayrollRoles())) return NextResponse.json({ error: "No autorizado." }, { status: 403 });

  const session = await auth();
  const { period } = await params;
  if (!isValidPeriod(period)) return NextResponse.json({ error: "Período inválido." }, { status: 400 });

  const payrollPeriod = await prisma.payrollPeriod.findUnique({
    where: { period },
    include: { roles: { where: { isCurrent: true }, include: { employee: { select: { id: true } } } } },
  });
  if (!payrollPeriod) return NextResponse.json({ error: "Primero hay que generar los roles de este período." }, { status: 404 });
  if (payrollPeriod.status === "PUBLISHED") return NextResponse.json({ error: "Ya estaba publicado." }, { status: 409 });

  const isAdmin = session!.user.role === "admin";

  if (isEndOfMonthQuincena(period)) {
    const month = monthOfPeriod(period);
    for (const role of payrollPeriod.roles) {
      const profile = await prisma.payrollProfile.findUnique({ where: { userId: role.employeeId } });
      if (!profile?.iessDeclaredSalary) continue;
      const legal = computeMonthlyLegalRole(profile.iessDeclaredSalary, profile.companyAbsorbsIess);
      await prisma.monthlyLegalRole.create({
        data: {
          employeeId: role.employeeId,
          month,
          ...legal,
          publishedById: isAdmin ? null : session!.user.id,
        },
      });
    }
  }

  const updated = await prisma.payrollPeriod.update({
    where: { id: payrollPeriod.id },
    data: { status: "PUBLISHED", publishedAt: new Date(), publishedById: isAdmin ? null : session!.user.id },
  });

  await notifyOwner("admin", {
    title: "🔔 Nairoby publicó un rol de pago",
    body: `Quincena ${period} — ${payrollPeriod.roles.length} colaborador${payrollPeriod.roles.length === 1 ? "" : "es"} · publicado por ${actorName(isAdmin ? null : session!.user.name)}`,
    url: "/admin",
  }).catch(() => null);

  // Confirmado 2026-08-23: la propuesta de transferencia (total + cuenta
  // destino) se crea sola al publicar — nunca antes (los roles deben estar
  // generados y publicados a mano primero) y nunca se recalcula sola
  // después de esto (ver roles/[roleId]/correct/route.ts para el único caso
  // en que sí se actualiza: una corrección mientras sigue sin aprobar).
  const totalAmount = payrollPeriod.roles.reduce((s, r) => s + r.netTotal, 0);
  await prisma.payrollTransfer.upsert({
    where: { periodId: payrollPeriod.id },
    update: {},
    create: { periodId: payrollPeriod.id, totalAmount, destination: isEndOfMonthQuincena(period) ? "ADMIN_PRODUBANCO" : "NAIROBY" },
  });

  return NextResponse.json(updated);
}
