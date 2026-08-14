import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { canProposeCommissionAmounts } from "@/lib/guards";

// Confirmado 2026-08-14: roster completo (todos los activos) x los 3
// niveles a la vez, mismo espíritu que /api/payroll/employees — Nairoby y
// el admin ven/editan todo de un vistazo, sin entrar persona por persona.
export async function GET() {
  if (!(await canProposeCommissionAmounts())) return NextResponse.json({ error: "No autorizado." }, { status: 403 });

  const [employees, tiers, amounts] = await Promise.all([
    prisma.user.findMany({
      where: { isActive: true },
      orderBy: { name: "asc" },
      select: { id: true, name: true, position: true, department: { select: { name: true } } },
    }),
    prisma.commissionTier.findMany({ where: { isActive: true }, orderBy: { orderIndex: "asc" } }),
    prisma.commissionTierAmount.findMany({ include: { proposedBy: { select: { name: true } } } }),
  ]);

  const amountsByKey = new Map(amounts.map((a) => [`${a.tierId}:${a.userId}`, a]));

  const rows = employees.map((e) => ({
    ...e,
    tiers: tiers.map((t) => {
      const a = amountsByKey.get(`${t.id}:${e.id}`);
      return {
        tierId: t.id,
        tierName: t.name,
        amount: a?.amount ?? 0,
        pendingAmount: a?.pendingAmount ?? null,
        proposedAt: a?.proposedAt?.toISOString() ?? null,
        proposedByName: a?.proposedBy?.name ?? (a?.proposedAt && !a.proposedBy ? "Administrador" : null),
      };
    }),
  }));

  return NextResponse.json({ tiers: tiers.map((t) => ({ id: t.id, name: t.name, orderIndex: t.orderIndex, minDailyAvg: t.minDailyAvg, maxDailyAvg: t.maxDailyAvg })), employees: rows });
}
