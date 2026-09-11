import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { canEditPayrollRoles } from "@/lib/guards";
import { isValidPeriod, buildAutomaticLineItems, totalsFromLineItems } from "@/lib/payroll";

// Confirmado 2026-09-11, pedido explícito del usuario: recalcular un
// período que sigue en borrador y sin ningún pago hecho, tomando de nuevo
// la información fuente (sueldos, bonos, comisiones, etc.) ya cargada o
// corregida — sin tener que arreglar la base de datos a mano. Solo toca
// las líneas automáticas (isAutomatic: true); lo que Nairoby agregó a mano
// ("+Agregar concepto") queda intacto.
export async function POST(_req: NextRequest, { params }: { params: Promise<{ period: string }> }) {
  if (!(await canEditPayrollRoles())) return NextResponse.json({ error: "No autorizado." }, { status: 403 });

  const { period } = await params;
  if (!isValidPeriod(period)) return NextResponse.json({ error: "Período inválido." }, { status: 400 });

  const payrollPeriod = await prisma.payrollPeriod.findUnique({ where: { period } });
  if (!payrollPeriod) return NextResponse.json({ error: "Este período todavía no fue generado." }, { status: 400 });
  if (payrollPeriod.status !== "DRAFT") {
    return NextResponse.json({ error: "Este período ya fue publicado — no se puede regenerar." }, { status: 409 });
  }

  const roles = await prisma.payrollQuincenaRole.findMany({
    where: { periodId: payrollPeriod.id, isCurrent: true },
    include: { lineItems: true },
  });
  if (roles.some((r) => r.paidAt)) {
    return NextResponse.json({ error: "Ya hay pagos registrados en este período — no se puede regenerar." }, { status: 409 });
  }

  const allIncludedGrantIds: string[] = [];
  for (const role of roles) {
    const manualItems = role.lineItems.filter((li) => !li.isAutomatic);
    const { items: newAutomaticItems, includedCeoBonusGrantIds } = await buildAutomaticLineItems(role.employeeId, period);
    const totals = totalsFromLineItems([...manualItems, ...newAutomaticItems]);
    await prisma.$transaction([
      prisma.payrollLineItem.deleteMany({ where: { roleId: role.id, isAutomatic: true } }),
      prisma.payrollQuincenaRole.update({
        where: { id: role.id },
        data: { ...totals, lineItems: { create: newAutomaticItems } },
      }),
    ]);
    allIncludedGrantIds.push(...includedCeoBonusGrantIds);
  }
  if (allIncludedGrantIds.length > 0) {
    await prisma.ceoBonusGrant.updateMany({
      where: { id: { in: allIncludedGrantIds } },
      data: { includedInPeriod: period },
    });
  }

  const full = await prisma.payrollPeriod.findUnique({
    where: { id: payrollPeriod.id },
    include: {
      roles: { where: { isCurrent: true }, include: { employee: { select: { id: true, name: true, position: true } }, lineItems: true } },
    },
  });
  return NextResponse.json(full);
}
