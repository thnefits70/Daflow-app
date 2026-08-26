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
  monthsBetween,
  IESS_LINE_ITEM_LABEL,
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
  if (profile?.monthlySalaryOnly) {
    if (isEndOfMonthQuincena(period)) {
      items.push({ label: "Sueldo (mensual)", amount: realSalary, kind: "INCOME", isAutomatic: true });
    } else {
      items.push({
        label: "Sueldo (mensual)",
        amount: 0,
        kind: "INCOME",
        isAutomatic: true,
        note: "Pago mensual único — se paga completo a fin de mes, no en este período.",
      });
    }
  } else {
    items.push({ label: "Sueldo", amount: quincenalSalaryPortion(realSalary), kind: "INCOME", isAutomatic: true });
  }

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
      // Confirmado 2026-08-21: pedido explícito del usuario — todo concepto
      // automático se muestra SIEMPRE, incluso en $0, con una nota que
      // explica por qué no aplicó — para que nunca quede ambiguo si algo
      // "no salió" porque no correspondía o porque se olvidó calcular.
      if (overtimeAmount > 0) {
        items.push({
          label: `Horas extra (${sourceMonth})`,
          amount: overtimeAmount,
          kind: "INCOME",
          isAutomatic: true,
          note: describeOvertimeCalculation(approvedEntries, OVERTIME_NATIONAL_BASE_SALARY),
        });
      } else {
        items.push({
          label: `Horas extra (${sourceMonth})`,
          amount: 0,
          kind: "INCOME",
          isAutomatic: true,
          note: `No se registraron horas extra aprobadas en ${sourceMonth}.`,
        });
      }

      const winner = await prisma.monthlyRecognitionResult.findUnique({ where: { month_rank: { month: sourceMonth, rank: 1 } } });
      if (winner?.userId === employeeId) {
        items.push({ label: `Bono colaborador destacado (${sourceMonth})`, amount: 50, kind: "INCOME", isAutomatic: true });
      } else {
        items.push({
          label: `Bono colaborador destacado (${sourceMonth})`,
          amount: 0,
          kind: "INCOME",
          isAutomatic: true,
          note: winner ? `No fue el colaborador destacado de ${sourceMonth}.` : `Todavía no se definió el colaborador destacado de ${sourceMonth}.`,
        });
      }

      // Confirmado 2026-08-14: comisión de equipo por nivel — el nivel
      // alcanzado el mes fuente completo, si esta persona tiene un monto
      // aprobado (>0) para ese nivel. Mismo desfase de un mes que horas
      // extra/bono destacado arriba.
      const dispatchSummary = await getMonthDispatchSummary(sourceMonth);
      let commissionShown = false;
      if (dispatchSummary) {
        const tier = await getAchievedTier(dispatchSummary.dailyAvg);
        const avgLabel = `Promedio real ${sourceMonth}: ${dispatchSummary.dailyAvg.toFixed(0)} pedidos/día`;
        if (tier) {
          const ta = await prisma.commissionTierAmount.findUnique({
            where: { tierId_userId: { tierId: tier.id, userId: employeeId } },
          });
          const range = `${tier.minDailyAvg}${tier.maxDailyAvg ? `-${tier.maxDailyAvg}` : "+"} pedidos/día`;
          if (ta && ta.amount > 0) {
            items.push({
              label: `Comisión de equipo (${tier.name} — ${sourceMonth})`,
              amount: ta.amount,
              kind: "INCOME",
              isAutomatic: true,
              note: `${avgLabel} — nivel ${tier.name} (${range})`,
            });
            commissionShown = true;
          } else {
            items.push({
              label: `Comisión de equipo (${sourceMonth})`,
              amount: 0,
              kind: "INCOME",
              isAutomatic: true,
              note: `${avgLabel} — alcanzó el nivel ${tier.name} (${range}), pero no tiene un monto de comisión configurado para ese nivel.`,
            });
            commissionShown = true;
          }
        } else {
          items.push({
            label: `Comisión de equipo (${sourceMonth})`,
            amount: 0,
            kind: "INCOME",
            isAutomatic: true,
            note: `${avgLabel} — no alcanzó ningún nivel de comisión ese mes.`,
          });
          commissionShown = true;
        }
      }
      if (!commissionShown) {
        items.push({
          label: `Comisión de equipo (${sourceMonth})`,
          amount: 0,
          kind: "INCOME",
          isAutomatic: true,
          note: `No hay datos de despachos cargados para ${sourceMonth}.`,
        });
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
      if (bonuses.length === 0) {
        items.push({
          label: `Bonos discrecionales del CEO (${sourceMonth})`,
          amount: 0,
          kind: "INCOME",
          isAutomatic: true,
          note: `No se otorgaron bonos discrecionales del CEO en ${sourceMonth}.`,
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
      } else {
        items.push({
          label: `Bonos especiales fijos (${sourceMonth})`,
          amount: 0,
          kind: "INCOME",
          isAutomatic: true,
          note: "No tiene un bono especial fijo configurado.",
        });
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
      let ordersShown = false;
      for (const o of orders) {
        const idx = installmentIndexForMonth(o.firstPayoutMonth!, o.installments, periodMonth);
        if (idx !== null) {
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
          const confirmedDate = o.financeConfirmedAt ? new Date(o.financeConfirmedAt).toLocaleDateString("es-EC") : null;
          const fullNote = `${note} — total $${o.totalAmount!.toFixed(2)} en ${o.installments} cuota(s)${confirmedDate ? ` — confirmada el ${confirmedDate}` : ""}`;
          items.push({ label, amount: amt, kind: "EXPENSE", isAutomatic: true, note: fullNote });
          ordersShown = true;
        } else if (monthsBetween(periodMonth, o.firstPayoutMonth!) > 0) {
          items.push({
            label: "Compra personal (pendiente)",
            amount: 0,
            kind: "EXPENSE",
            isAutomatic: true,
            note: `Compra aprobada de $${o.totalAmount!.toFixed(2)} en ${o.installments} cuota(s) — la primera cuota corresponde a ${o.firstPayoutMonth}, no a este período.`,
          });
          ordersShown = true;
        }
      }
      if (!ordersShown) {
        items.push({ label: "Compras personales", amount: 0, kind: "EXPENSE", isAutomatic: true, note: "No tiene compras personales activas en rol." });
      }

      const advances = await prisma.salaryAdvance.findMany({
        where: { employeeId, status: "APPROVED", firstPayoutMonth: { not: null } },
      });
      let advancesShown = false;
      for (const a of advances) {
        const idx = installmentIndexForMonth(a.firstPayoutMonth!, a.installments, periodMonth);
        if (idx !== null) {
          const amt = installmentAmount(a.amount, a.installments, idx);
          const cuota = a.installments > 1 ? ` (cuota ${idx + 1}/${a.installments})` : "";
          const approvedDate = a.approvedAt ? new Date(a.approvedAt).toLocaleDateString("es-EC") : null;
          items.push({
            label: `Anticipo${cuota}`,
            amount: amt,
            kind: "EXPENSE",
            isAutomatic: true,
            note: `Anticipo total $${a.amount.toFixed(2)} en ${a.installments} cuota(s)${approvedDate ? ` — aprobado el ${approvedDate}` : ""}`,
          });
          advancesShown = true;
        } else if (monthsBetween(periodMonth, a.firstPayoutMonth!) > 0) {
          items.push({
            label: "Anticipo (pendiente)",
            amount: 0,
            kind: "EXPENSE",
            isAutomatic: true,
            note: `Anticipo aprobado de $${a.amount.toFixed(2)} en ${a.installments} cuota(s) — la primera cuota corresponde a ${a.firstPayoutMonth}, no a este período.`,
          });
          advancesShown = true;
        }
      }
      if (!advancesShown) {
        items.push({ label: "Anticipos", amount: 0, kind: "EXPENSE", isAutomatic: true, note: "No tiene anticipos activos." });
      }

      const deductions = await prisma.managementDeduction.findMany({
        where: { employeeId, acceptedAt: { not: null }, firstPayoutMonth: { not: null } },
      });
      let deductionsShown = false;
      for (const d of deductions) {
        const idx = installmentIndexForMonth(d.firstPayoutMonth!, d.installments, periodMonth);
        if (idx !== null) {
          const amt = installmentAmount(d.totalAmount, d.installments, idx);
          const cuota = d.installments > 1 ? ` (cuota ${idx + 1}/${d.installments})` : "";
          const shortReason = d.reason.length > 40 ? `${d.reason.slice(0, 40)}…` : d.reason;
          const acceptedDate = d.acceptedAt ? new Date(d.acceptedAt).toLocaleDateString("es-EC") : null;
          items.push({
            label: `Descuento — ${shortReason}${cuota}`,
            amount: amt,
            kind: "EXPENSE",
            isAutomatic: true,
            note: `Motivo completo: "${d.reason}" — total $${d.totalAmount.toFixed(2)} en ${d.installments} cuota(s)${acceptedDate ? ` — aceptado el ${acceptedDate}` : ""}`,
          });
          deductionsShown = true;
        } else if (monthsBetween(periodMonth, d.firstPayoutMonth!) > 0) {
          const shortReason = d.reason.length > 40 ? `${d.reason.slice(0, 40)}…` : d.reason;
          items.push({
            label: `Descuento — ${shortReason} (pendiente)`,
            amount: 0,
            kind: "EXPENSE",
            isAutomatic: true,
            note: `Descuento aceptado de $${d.totalAmount.toFixed(2)} en ${d.installments} cuota(s) — la primera cuota corresponde a ${d.firstPayoutMonth}, no a este período.`,
          });
          deductionsShown = true;
        }
      }
      if (!deductionsShown) {
        items.push({ label: "Descuentos por mala gestión", amount: 0, kind: "EXPENSE", isAutomatic: true, note: "No tiene descuentos activos." });
      }
    }
  }

  if (isEndOfMonthQuincena(period) && profile?.iessDeclaredSalary && !profile.companyAbsorbsIess) {
    const iess = computeIessDeduction(profile.iessDeclaredSalary, profile.companyAbsorbsIess);
    if (iess > 0) items.push({ label: IESS_LINE_ITEM_LABEL, amount: iess, kind: "EXPENSE", isAutomatic: true });
  }

  return items;
}

export function totalsFromLineItems(items: { amount: number; kind: "INCOME" | "EXPENSE" }[]) {
  const totalIncome = items.filter((i) => i.kind === "INCOME").reduce((s, i) => s + i.amount, 0);
  const totalExpense = items.filter((i) => i.kind === "EXPENSE").reduce((s, i) => s + i.amount, 0);
  return { totalIncome, totalExpense, netTotal: totalIncome - totalExpense };
}

// Confirmado 2026-08-26: pedido explícito del usuario — además del total de
// nómina a transferir, un segundo total con lo retenido de IESS a TODOS los
// colaboradores ese período (suma de la línea automática "Descuento IESS
// (9.45%)" de cada rol vigente, respetando cualquier corrección manual que
// Nairoby le haya hecho a esa línea). Solo tiene sentido en la quincena de
// fin de mes (Q2) — es cuando se genera esa línea (ver isEndOfMonthQuincena
// arriba en buildAutomaticLineItems).
export function totalIessFromRoles(roles: { lineItems: { label: string; amount: number }[] }[]): number {
  return roles.reduce((sum, r) => sum + r.lineItems.filter((li) => li.label === IESS_LINE_ITEM_LABEL).reduce((s, li) => s + li.amount, 0), 0);
}

// Confirmado 2026-08-20, reglas de anticipos definidas con el usuario:
// mínimo $20, hasta $100 sin justificar, de $100 a $200 con motivo
// obligatorio (emergencia familiar u otro con descripción breve).
export const SALARY_ADVANCE_MIN_AMOUNT = 20;
export const SALARY_ADVANCE_NO_JUSTIFICATION_MAX = 100;
export const SALARY_ADVANCE_MAX_AMOUNT = 200;
// Tope de saldo pendiente de pago (sumando varios anticipos) — una vez
// alcanzado, se bloquean nuevas solicitudes hasta que las cuotas de los
// anticipos actuales se terminen de pagar (ver pendingSalaryAdvanceBalance).
export const SALARY_ADVANCE_PENDING_CAP = 150;

// Cuánto le queda pendiente de pago a un colaborador en anticipos: el total
// de los PENDING (podrían aprobarse) más el saldo sin pagar de los APPROVED
// — una cuota cuenta como pagada solo cuando su quincena Q1 correspondiente
// ya fue PUBLISHED (no alcanza con que el mes calendario haya pasado, un
// período puede seguir en borrador). Mismo criterio que buildAutomaticLineItems
// usa para decidir qué cuota corresponde a cada período.
export async function pendingSalaryAdvanceBalance(employeeId: string): Promise<number> {
  const advances = await prisma.salaryAdvance.findMany({
    where: { employeeId, status: { in: ["PENDING", "APPROVED"] } },
  });
  if (advances.length === 0) return 0;

  const publishedPeriods = await prisma.payrollPeriod.findMany({
    where: { status: "PUBLISHED" },
    select: { period: true },
  });
  const publishedSet = new Set(publishedPeriods.map((p) => p.period));

  let total = 0;
  for (const a of advances) {
    if (a.status === "PENDING") {
      total += a.amount;
      continue;
    }
    if (!a.firstPayoutMonth) {
      total += a.amount;
      continue;
    }
    for (let idx = 0; idx < a.installments; idx++) {
      const month = addMonthsToMonthStr(a.firstPayoutMonth, idx);
      if (!publishedSet.has(`${month}-Q1`)) total += installmentAmount(a.amount, a.installments, idx);
    }
  }
  return Math.round(total * 100) / 100;
}
