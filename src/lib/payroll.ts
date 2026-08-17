import { prisma } from "@/lib/prisma";
import {
  quincenalSalaryPortion,
  computeOvertimeAmount,
  computeIessDeduction,
  overtimeSourceMonthForPeriod,
  isFirstQuincenaOfMonth,
  isEndOfMonthQuincena,
  OVERTIME_NATIONAL_BASE_SALARY,
  describeOvertimeCalculation,
} from "@/lib/payrollCalc";
import { getMonthDispatchSummary, getAchievedTier, CEO_BONUS_AMOUNTS, CEO_BONUS_LABELS } from "@/lib/commissionTiers";

const PERIOD_RE = /^\d{4}-\d{2}-Q[12]$/;

export function isValidPeriod(period: string): boolean {
  return PERIOD_RE.test(period);
}

export type QuincenaLineItemInput = { label: string; amount: number; kind: "INCOME" | "EXPENSE"; isAutomatic: boolean; note?: string };

// Confirmado 2026-08-13: todo (sueldo, horas extra, bono, IESS) vive como
// línea suelta desde el arranque — Nairoby puede editar o quitar cualquiera,
// incluso las automáticas.
export async function buildAutomaticLineItems(employeeId: string, period: string): Promise<QuincenaLineItemInput[]> {
  const profile = await prisma.payrollProfile.findUnique({ where: { userId: employeeId } });

  const items: QuincenaLineItemInput[] = [];
  const realSalary = profile?.realSalary ?? 0;
  items.push({ label: "Sueldo (quincena)", amount: quincenalSalaryPortion(realSalary), kind: "INCOME", isAutomatic: true });

  if (isFirstQuincenaOfMonth(period)) {
    const sourceMonth = overtimeSourceMonthForPeriod(period);
    if (sourceMonth) {
      const [y, m] = sourceMonth.split("-").map(Number);
      const monthStart = new Date(Date.UTC(y, m - 1, 1));
      const monthEnd = new Date(Date.UTC(y, m, 1));

      const approvedEntries = await prisma.overtimeEntry.findMany({
        where: { employeeId, date: { gte: monthStart, lt: monthEnd }, approvedAt: { not: null } },
      });
      const overtimeAmount = approvedEntries.reduce(
        (s, e) => s + computeOvertimeAmount(OVERTIME_NATIONAL_BASE_SALARY, e.minutesExtra, e.date),
        0
      );
      if (overtimeAmount > 0) {
        items.push({
          label: `Horas extra (${sourceMonth})`,
          amount: overtimeAmount,
          kind: "INCOME",
          isAutomatic: true,
          note: describeOvertimeCalculation(approvedEntries, OVERTIME_NATIONAL_BASE_SALARY),
        });
      }

      const winner = await prisma.monthlyRecognitionResult.findUnique({ where: { month_rank: { month: sourceMonth, rank: 1 } } });
      if (winner?.userId === employeeId) {
        items.push({ label: `Bono colaborador destacado (${sourceMonth})`, amount: 50, kind: "INCOME", isAutomatic: true });
      }

      // Confirmado 2026-08-14: comisión de equipo por nivel — el nivel
      // alcanzado el mes fuente completo, si esta persona tiene un monto
      // aprobado (>0) para ese nivel. Mismo desfase de un mes que horas
      // extra/bono destacado arriba.
      const dispatchSummary = await getMonthDispatchSummary(sourceMonth);
      if (dispatchSummary) {
        const tier = await getAchievedTier(dispatchSummary.dailyAvg);
        if (tier) {
          const ta = await prisma.commissionTierAmount.findUnique({
            where: { tierId_userId: { tierId: tier.id, userId: employeeId } },
          });
          if (ta && ta.amount > 0) {
            items.push({ label: `Comisión de equipo (${tier.name} — ${sourceMonth})`, amount: ta.amount, kind: "INCOME", isAutomatic: true });
          }
        }
      }

      // Bonos discrecionales del CEO otorgados durante el mes fuente —
      // confidencial, confirmado 2026-08-14: nunca se paga en el mismo mes
      // en que se otorga, siempre en la Q1 del mes siguiente.
      const bonuses = await prisma.ceoBonusGrant.findMany({
        where: { userId: employeeId, grantedAt: { gte: monthStart, lt: monthEnd } },
      });
      for (const b of bonuses) {
        items.push({
          label: `${CEO_BONUS_LABELS[b.type]} (${sourceMonth})`,
          amount: CEO_BONUS_AMOUNTS[b.type],
          kind: "INCOME",
          isAutomatic: true,
        });
      }
    }
  }

  if (isEndOfMonthQuincena(period) && profile?.iessDeclaredSalary && !profile.companyAbsorbsIess) {
    const iess = computeIessDeduction(profile.iessDeclaredSalary, profile.companyAbsorbsIess);
    if (iess > 0) items.push({ label: "Descuento IESS (9.45%)", amount: iess, kind: "EXPENSE", isAutomatic: true });
  }

  return items;
}

export function totalsFromLineItems(items: { amount: number; kind: "INCOME" | "EXPENSE" }[]) {
  const totalIncome = items.filter((i) => i.kind === "INCOME").reduce((s, i) => s + i.amount, 0);
  const totalExpense = items.filter((i) => i.kind === "EXPENSE").reduce((s, i) => s + i.amount, 0);
  return { totalIncome, totalExpense, netTotal: totalIncome - totalExpense };
}
