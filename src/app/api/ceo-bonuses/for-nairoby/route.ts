import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { canProposeCommissionAmounts } from "@/lib/guards";
import { overtimePayoutPeriod } from "@/lib/payrollCalc";
import { CEO_BONUS_AMOUNTS } from "@/lib/commissionTiers";

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

  // Corregido 2026-10-01: antes la quincena se calculaba siempre como "Q1
  // del mes siguiente al otorgado", ignorando dónde se pagó de verdad — un
  // bono otorgado el 5/9 y pagado en 2026-09-Q1 le aparecía a Nairoby como
  // pendiente en 2026-10-Q1 (como si se fuera a pagar dos veces). Ahora:
  // 1) si el rol ya lo marcó (includedInPeriod), esa es la quincena real;
  // 2) PERSONALIZADO usa la quincena que eligió el admin (targetPeriod);
  // 3) un bono fijo todavía sin marcar entra en la próxima Q1 que aún no se
  //    generó, igual que en buildAutomaticLineItems.
  const generated = new Set(
    (await prisma.payrollPeriod.findMany({ where: { generatedAt: { not: null } }, select: { period: true } })).map((p) => p.period)
  );
  function nextUngeneratedQ1(from: Date): string {
    let ym = from.toISOString().slice(0, 7);
    let period = `${ym}-Q1`;
    while (generated.has(period)) {
      period = overtimePayoutPeriod(ym);
      ym = period.slice(0, 7);
    }
    return period;
  }
  const withPeriod = grants.map((g) => ({
    ...g,
    targetPeriod:
      g.includedInPeriod ??
      (g.type === "PERSONALIZADO" ? g.targetPeriod ?? nextUngeneratedQ1(g.grantedAt) : nextUngeneratedQ1(g.grantedAt)),
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
      amount: g.type === "PERSONALIZADO" ? g.amount ?? 0 : CEO_BONUS_AMOUNTS[g.type as "ADICIONAL" | "PRODUCTIVIDAD" | "MERITO"],
      grantedAt: g.grantedAt,
      user: g.user,
      targetPeriod: g.targetPeriod,
      status: role?.paidAt ? "PAID" : role ? "INCLUDED" : "PENDING",
      paidAt: role?.paidAt ?? null,
    };
  });

  return NextResponse.json(result);
}
