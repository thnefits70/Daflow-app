import { prisma } from "@/lib/prisma";
import {
  quincenalSalaryPortion,
  computeOvertimeAmount,
  computeIessDeduction,
  overtimeSourceMonthForPeriod,
  isFirstQuincenaOfMonth,
  isEndOfMonthQuincena,
  monthOfPeriod,
  OVERTIME_NATIONAL_BASE_SALARY,
  describeOvertimeCalculation,
  installmentAmount,
  installmentIndexForMonth,
  addMonthsToMonthStr,
} from "@/lib/payrollCalc";
import { getMonthDispatchSummary, getAchievedTier, CEO_BONUS_AMOUNTS, CEO_BONUS_LABELS } from "@/lib/commissionTiers";

const PERIOD_RE = /^\d{4}-\d{2}-Q[12]$/;

export function isValidPeriod(period: string): boolean {
  return PERIOD_RE.test(period);
}

export type QuincenaLineItemInput = { label: string; amount: number; kind: "INCOME" | "EXPENSE"; isAutomatic: boolean; note?: string };

// Confirmado 2026-08-18: decide el mes real de arranque de un egreso en
// cuotas (compra personal, anticipo, descuento por mala gestión) — si el
// mes "natural" ya tiene su Q1 generada, se corre un mes para no perder esa
// cuota. Se resuelve UNA sola vez, al momento en que el egreso queda 100%
// activo (Nairoby confirma el precio / admin aprueba / colaborador acepta)
// — nunca se recalcula después, es un hecho puntual como approvedAt.
export async function resolveFirstPayoutMonth(naturalFirstMonth: string): Promise<string> {
  const existing = await prisma.payrollPeriod.findUnique({ where: { period: `${naturalFirstMonth}-Q1` } });
  return existing ? addMonthsToMonthStr(naturalFirstMonth, 1) : naturalFirstMonth;
}

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

      // Confirmado 2026-08-17: bono especial fijo mensual (aprobado por el
      // admin) — mismo desfase de un mes que todo lo demás en este bloque,
      // pedido explícito del usuario: "todos los bonos, comisiones, horas
      // extras deben sumarse al pago de su sueldo base en la primera
      // quincena del mes siguiente".
      const fixedBonus = await prisma.fixedMonthlyBonus.findUnique({ where: { userId: employeeId } });
      if (fixedBonus && fixedBonus.amount > 0) {
        items.push({ label: `Bonos especiales fijos (${sourceMonth})`, amount: fixedBonus.amount, kind: "INCOME", isAutomatic: true });
      }

      // Confirmado 2026-08-18: los 3 egresos automáticos (compras
      // personales, anticipos, descuentos por mala gestión) NO usan
      // sourceMonth (el mes anterior) — usan periodMonth (el mes propio de
      // este período), porque firstPayoutMonth ya está expresado como "el
      // mes cuya Q1 paga la primera cuota", no como un mes de origen a
      // desfasar de nuevo.
      const periodMonth = monthOfPeriod(period);

      // Confirmado 2026-08-18: rediseño — una compra ahora es un pedido con
      // varios productos posibles. El label resume el pedido; el note
      // desglosa cada producto (nombre confirmado × cantidad, cuántas
      // unidades a costo vs. Dropi) — mismo patrón que describeOvertimeCalculation.
      const orders = await prisma.personalPurchaseOrder.findMany({
        where: { employeeId, status: "APPROVED", firstPayoutMonth: { not: null }, totalAmount: { not: null } },
        include: { items: true },
      });
      for (const o of orders) {
        const idx = installmentIndexForMonth(o.firstPayoutMonth!, o.installments, periodMonth);
        if (idx === null) continue;
        const amt = installmentAmount(o.totalAmount!, o.installments, idx);
        const cuota = o.installments > 1 ? ` (cuota ${idx + 1}/${o.installments})` : "";
        const firstName = o.items[0] ? o.items[0].confirmedProductName ?? o.items[0].employeeProductName : "producto";
        const label = o.items.length > 1 ? `Compra personal — ${o.items.length} productos${cuota}` : `Compra personal — ${firstName}${cuota}`;
        const note = o.items
          .map((it) => {
            const modes = Array.isArray(it.unitPriceModes) ? (it.unitPriceModes as string[]) : [];
            const costCount = modes.filter((m) => m === "COST").length;
            const dropiCount = modes.filter((m) => m === "DROPI").length;
            const name = it.confirmedProductName ?? it.employeeProductName;
            const split = [costCount > 0 ? `${costCount} al costo` : null, dropiCount > 0 ? `${dropiCount} Dropi` : null].filter(Boolean).join(" · ");
            return `${name} × ${it.quantity}${split ? ` (${split})` : ""}`;
          })
          .join(" · ");
        items.push({ label, amount: amt, kind: "EXPENSE", isAutomatic: true, note });
      }

      const advances = await prisma.salaryAdvance.findMany({
        where: { employeeId, status: "APPROVED", firstPayoutMonth: { not: null } },
      });
      for (const a of advances) {
        const idx = installmentIndexForMonth(a.firstPayoutMonth!, a.installments, periodMonth);
        if (idx === null) continue;
        const amt = installmentAmount(a.amount, a.installments, idx);
        const cuota = a.installments > 1 ? ` (cuota ${idx + 1}/${a.installments})` : "";
        items.push({ label: `Anticipo${cuota}`, amount: amt, kind: "EXPENSE", isAutomatic: true });
      }

      const deductions = await prisma.managementDeduction.findMany({
        where: { employeeId, acceptedAt: { not: null }, firstPayoutMonth: { not: null } },
      });
      for (const d of deductions) {
        const idx = installmentIndexForMonth(d.firstPayoutMonth!, d.installments, periodMonth);
        if (idx === null) continue;
        const amt = installmentAmount(d.totalAmount, d.installments, idx);
        const cuota = d.installments > 1 ? ` (cuota ${idx + 1}/${d.installments})` : "";
        const shortReason = d.reason.length > 40 ? `${d.reason.slice(0, 40)}…` : d.reason;
        items.push({ label: `Descuento — ${shortReason}${cuota}`, amount: amt, kind: "EXPENSE", isAutomatic: true });
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
