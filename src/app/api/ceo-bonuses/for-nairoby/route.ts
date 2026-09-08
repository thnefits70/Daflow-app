import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { canProposeCommissionAmounts } from "@/lib/guards";
import { overtimePayoutPeriod } from "@/lib/payrollCalc";

// Confirmado 2026-08-14: pedido explícito del usuario — Nairoby (o admin)
// ve una lista compacta de qué bonos otorgó el CEO, para saber que vienen
// incluidos en la próxima quincena. Nunca visible a nadie más.
// Ampliado 2026-09-08: pedido explícito del usuario — poder filtrar por la
// quincena en la que se paga cada bono (mismo desfase que horas extra, ver
// overtimePayoutPeriod) y ver si esa quincena ya se generó/pagó, para poder
// verificar qué bonos ya se pagaron y cuáles todavía faltan.
export async function GET(req: NextRequest) {
  if (!(await canProposeCommissionAmounts())) return NextResponse.json({ error: "No autorizado." }, { status: 403 });

  const periodFilter = req.nextUrl.searchParams.get("period");

  const grants = await prisma.ceoBonusGrant.findMany({
    orderBy: { grantedAt: "desc" },
    take: 300,
    include: { user: { select: { name: true } } },
  });

  const withPeriod = grants.map((g) => ({
    ...g,
    targetPeriod: overtimePayoutPeriod(g.grantedAt.toISOString().slice(0, 7)),
  }));
  const filtered = periodFilter ? withPeriod.filter((g) => g.targetPeriod === periodFilter) : withPeriod;

  const roles = filtered.length
    ? await prisma.payrollQuincenaRole.findMany({
        where: {
          isCurrent: true,
          employeeId: { in: [...new Set(filtered.map((g) => g.userId))] },
          period: { period: { in: [...new Set(filtered.map((g) => g.targetPeriod))] } },
        },
        select: { employeeId: true, paidAt: true, period: { select: { period: true } } },
      })
    : [];
  const roleByKey = new Map(roles.map((r) => [`${r.employeeId}__${r.period.period}`, r]));

  const result = filtered.map((g) => {
    const role = roleByKey.get(`${g.userId}__${g.targetPeriod}`);
    return {
      id: g.id,
      type: g.type,
      note: g.note,
      grantedAt: g.grantedAt,
      user: g.user,
      targetPeriod: g.targetPeriod,
      status: role?.paidAt ? "PAID" : role ? "INCLUDED" : "PENDING",
      paidAt: role?.paidAt ?? null,
    };
  });

  return NextResponse.json(result);
}
