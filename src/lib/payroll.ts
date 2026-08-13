import { prisma } from "@/lib/prisma";
import {
  quincenalSalaryPortion,
  computeOvertimeAmount,
  computeIessDeduction,
  overtimeSourceMonthForPeriod,
  isFirstQuincenaOfMonth,
  isEndOfMonthQuincena,
} from "@/lib/payrollCalc";

const PERIOD_RE = /^\d{4}-\d{2}-Q[12]$/;

export function isValidPeriod(period: string): boolean {
  return PERIOD_RE.test(period);
}

export type QuincenaLineItemInput = { label: string; amount: number; kind: "INCOME" | "EXPENSE"; isAutomatic: boolean };

// Confirmado 2026-08-13: todo (sueldo, horas extra, bono, IESS) vive como
// línea suelta desde el arranque — Nairoby puede editar o quitar cualquiera,
// incluso las automáticas.
export async function buildAutomaticLineItems(employeeId: string, period: string): Promise<QuincenaLineItemInput[]> {
  const [profile, settings] = await Promise.all([
    prisma.payrollProfile.findUnique({ where: { userId: employeeId } }),
    prisma.payrollSettings.findFirst(),
  ]);

  const items: QuincenaLineItemInput[] = [];
  const realSalary = profile?.realSalary ?? 0;
  items.push({ label: "Sueldo (quincena)", amount: quincenalSalaryPortion(realSalary), kind: "INCOME", isAutomatic: true });

  if (isFirstQuincenaOfMonth(period)) {
    const sourceMonth = overtimeSourceMonthForPeriod(period);
    if (sourceMonth && settings?.nationalBaseSalary) {
      const [y, m] = sourceMonth.split("-").map(Number);
      const monthStart = new Date(Date.UTC(y, m - 1, 1));
      const monthEnd = new Date(Date.UTC(y, m, 1));
      const approvedEntries = await prisma.overtimeEntry.findMany({
        where: { employeeId, date: { gte: monthStart, lt: monthEnd }, approvedAt: { not: null } },
      });
      const overtimeAmount = approvedEntries.reduce(
        (s, e) => s + computeOvertimeAmount(settings.nationalBaseSalary, e.minutesExtra, e.date),
        0
      );
      if (overtimeAmount > 0) {
        items.push({ label: `Horas extra (${sourceMonth})`, amount: overtimeAmount, kind: "INCOME", isAutomatic: true });
      }

      const winner = await prisma.monthlyRecognitionResult.findUnique({ where: { month_rank: { month: sourceMonth, rank: 1 } } });
      if (winner?.userId === employeeId) {
        items.push({ label: `Bono colaborador destacado (${sourceMonth})`, amount: 50, kind: "INCOME", isAutomatic: true });
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
