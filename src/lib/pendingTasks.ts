import { auth } from "@/auth";
import { prisma } from "@/lib/prisma";
import { isFixedHoliday, evaluationDeadline, adminConfirmDeadline } from "@/lib/recognition";
import { addBusinessHours } from "@/lib/businessHours";
import { getPettyCashBoxData, type PettyCashBoxTypeStr } from "@/lib/pettyCash";
import { getUpcomingBirthdays } from "@/lib/birthdays";

// ---------------- Date helpers ----------------
// Deadline rule confirmed by the user 2026-07-20: work week is Mon-Sat, and
// the deadline to have a week's data in is the following Monday — since ISO
// weeks always start on Monday, comparing week strings is enough (no partial
// weeks to worry about). Months don't line up as cleanly (a month can start
// on any weekday), so the monthly deadline needs real date math: the first
// Monday that falls in the *following* month.
//
// Every function below works entirely in UTC-fixed arithmetic (Date.UTC,
// getUTC*/setUTC*, never the local-timezone Date methods) and "now" is
// always pre-shifted to Ecuador's wall clock first (nowInEcuador). Mixing
// UTC and server-local dates here was a real bug caught during verification
// — Vercel runs in UTC, so treating a UTC midnight instant as a local date
// via getMonth()/getDate() silently shifted it a day back once the server's
// timezone didn't match Ecuador's.
const ECUADOR_UTC_OFFSET_HOURS = 5; // UTC-5, no daylight saving in Ecuador

function nowInEcuador(): Date {
  return new Date(Date.now() - ECUADOR_UTC_OFFSET_HOURS * 3600 * 1000);
}

function pad2(n: number) {
  return String(n).padStart(2, "0");
}

// ISO weekday of `date` (1=Monday ... 7=Sunday), same UTC-safe conversion
// `isoWeekOf` already uses.
function isoWeekdayOf(date: Date): number {
  return date.getUTCDay() || 7;
}

function isoWeekOf(date: Date): string {
  const d = new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()));
  const dayNum = d.getUTCDay() || 7;
  d.setUTCDate(d.getUTCDate() + 4 - dayNum);
  const yearStart = new Date(Date.UTC(d.getUTCFullYear(), 0, 1));
  const weekNum = Math.ceil(((d.getTime() - yearStart.getTime()) / 86400000 + 1) / 7);
  return `${d.getUTCFullYear()}-W${pad2(weekNum)}`;
}

function mondayOfIsoWeek(week: string): Date {
  const [yearStr, wStr] = week.split("-W");
  const year = Number(yearStr);
  const weekNum = Number(wStr);
  const jan4 = new Date(Date.UTC(year, 0, 4));
  const jan4Day = jan4.getUTCDay() || 7;
  const week1Monday = new Date(jan4);
  week1Monday.setUTCDate(jan4.getUTCDate() - (jan4Day - 1));
  const target = new Date(week1Monday);
  target.setUTCDate(week1Monday.getUTCDate() + (weekNum - 1) * 7);
  return target;
}

function prevIsoWeek(week: string): string {
  const monday = mondayOfIsoWeek(week);
  monday.setUTCDate(monday.getUTCDate() - 7);
  return isoWeekOf(monday);
}

const MONTH_ABBR = ["Ene", "Feb", "Mar", "Abr", "May", "Jun", "Jul", "Ago", "Sep", "Oct", "Nov", "Dic"];

function formatWeekLabel(week: string) {
  const [, w] = week.split("-W");
  return `S${Number(w)}`;
}

function formatMonthLabel(month: string) {
  const [y, m] = month.split("-");
  return `${MONTH_ABBR[Number(m) - 1]} ${y.slice(2)}`;
}

function currentMonthStr(): string {
  const d = nowInEcuador();
  return `${d.getUTCFullYear()}-${pad2(d.getUTCMonth() + 1)}`;
}

function prevMonthStr(month: string): string {
  const [y, m] = month.split("-").map(Number);
  const d = new Date(Date.UTC(y, m - 2, 1));
  return `${d.getUTCFullYear()}-${pad2(d.getUTCMonth() + 1)}`;
}

// Company work week is Mon-Sat (confirmed 2026-07-20) — only Sunday and
// Ecuadorian national holidays (fixed-date list shared with
// src/lib/recognition.ts) are non-business days here. Deliberately not the
// same "weekend" definition as recognition.ts's isBusinessDay (which treats
// Saturday as off, for a different, unrelated deadline).
function isCompanyBusinessDay(date: Date): boolean {
  return date.getUTCDay() !== 0 && !isFixedHoliday(date);
}

function nthDayOfMonth(month: string, day: number): Date {
  const [y, m] = month.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, day));
}

function rollToNextBusinessDay(date: Date): Date {
  let d = date;
  while (!isCompanyBusinessDay(d)) d = new Date(d.getTime() + 86400000);
  return d;
}

// Some monthly items have their own fixed check-in day instead of "first
// Monday of next month" — e.g. Roles de pago (día 3) and Tasa de Devolución
// (día 4) for Nairoby, confirmed 2026-07-22. If that day itself isn't a
// business day, the alert simply starts the next business day instead.
function fixedDayDeadlinePassed(month: string, day: number): boolean {
  const deadline = rollToNextBusinessDay(nthDayOfMonth(month, day));
  return nowInEcuador() >= deadline;
}

// Same as nthDayOfMonth but clamped to the last real day of the month —
// Pagos recordatorios lets each reminder's día de vencimiento be up to 31,
// which doesn't exist in every month (e.g. February).
function nthDayOfMonthClamped(month: string, day: number): Date {
  const [y, m] = month.split("-").map(Number);
  const daysInMonth = new Date(Date.UTC(y, m, 0)).getUTCDate();
  return new Date(Date.UTC(y, m - 1, Math.min(day, daysInMonth)));
}

// ---------------- Generic period-status resolvers ----------------
// Only ever surfaces something once it's genuinely overdue (previous
// period's deadline already passed and still empty) — never a heads-up for
// the still-in-progress current period. The user explicitly doesn't want to
// see a reminder at all while they're on time; it should only appear once
// they're actually behind.
// `reviewWeekday` (1=Monday...7=Sunday) is when THIS particular reminder is
// allowed to start appearing at all — e.g. the admin's actual meeting day
// with that department's leader — not just "the new week began". Before
// that weekday arrives, stays silent even if the previous week is empty.
// Defaults to Monday, which is the original, still-correct rule for every
// weekly item that isn't tied to a specific meeting day.
async function weeklyPendingStatus(
  exists: (week: string) => Promise<boolean>,
  reviewWeekday: number = 1
): Promise<{ week: string; overdue: boolean } | null> {
  const now = nowInEcuador();
  if (isoWeekdayOf(now) < reviewWeekday) return null;
  const today = isoWeekOf(now);
  const prev = prevIsoWeek(today);
  if (!(await exists(prev))) return { week: prev, overdue: true };
  return null;
}

// n-th (1-based) occurrence of `weekday` (1=Monday...7=Sunday) within
// `month` ("YYYY-MM") — e.g. the 4th Thursday.
function nthWeekdayOfMonth(month: string, weekday: number, n: number): Date {
  const [y, m] = month.split("-").map(Number);
  const first = new Date(Date.UTC(y, m - 1, 1));
  const firstWeekday = first.getUTCDay() || 7;
  let offset = weekday - firstWeekday;
  if (offset < 0) offset += 7;
  first.setUTCDate(1 + offset + (n - 1) * 7);
  return first;
}

// Some departments only meet the admin once a month, not weekly — e.g.
// Finanzas y Contabilidad with Nairoby, confirmed 2026-07-21: the 4th
// Thursday of every month. The alert appears starting that day, checks
// whether that month's review is already filled, and disappears once it
// is — never a weekly nag for a once-a-month relationship.
async function monthlyReviewStatus(
  exists: (week: string) => Promise<boolean>,
  weekday: number,
  occurrence: number
): Promise<{ month: string; overdue: boolean } | null> {
  const now = nowInEcuador();
  const month = currentMonthStr();
  const meetingDate = nthWeekdayOfMonth(month, weekday, occurrence);
  if (now < meetingDate) return null;
  const week = isoWeekOf(meetingDate);
  if (!(await exists(week))) return { month, overdue: true };
  return null;
}

// ---------------- Public types ----------------
// `type` es el identificador estable de la categoría (ej. "roles_de_pago")
// — confirmado 2026-07-28, usado para que cada persona pueda activar o
// desactivar notificaciones push por tipo, sin depender del texto (que sí
// puede variar, ej. "Feedback semanal — Análisis de Mercado").
export type PendingItem = {
  type: string;
  icon: string;
  label: string;
  meta: string;
  overdue: boolean;
  href: string;
};

export type PendingTasks = { title: string; sub: string; items: PendingItem[] };

// Catálogo de categorías notificables por push, con su etiqueta legible —
// usado por /api/push/preferences para armar la lista de interruptores.
export const PENDING_TYPE_CATALOG: Record<string, string> = {
  feedback: "Feedback semanal/mensual de departamentos",
  roles_de_pago: "Roles de pago",
  tasa_devolucion: "Tasa de Devolución General",
  kpi_garantias: "KPI de Garantías",
  pagos_recordatorios: "Pagos recordatorios",
  servicio_postventa: "Servicio Postventa",
  pedidos_despachados: "Pedidos despachados / Fill Rate",
  ruptura_stock: "Ruptura de Stock",
  caja_chica_saldo: "Caja Chica — saldo bajo",
  caja_chica_confirmacion: "Caja Chica — falta que confirmen una recarga",
  cumpleanos: "Cumpleaños de tu equipo (aviso 1 día antes)",
};

// "colaborador_del_mes" es obligatorio — confirmado 2026-08-05: a diferencia
// de todo lo demás en este archivo, el líder NO puede apagar este push. Por
// eso deliberadamente no está en PENDING_TYPE_CATALOG ni en
// getPossiblePendingTypesForActor (no aparece en "Preferencias de
// notificaciones" para desactivarlo) y el cron lo manda sin mirar
// getDisabledTypes. Deja de aparecer solo/naturalmente en cuanto el líder ya
// no tiene a nadie pendiente de calificar — nunca por elección propia.
export const MANDATORY_PUSH_TYPES = new Set(["colaborador_del_mes"]);

// Each department's admin-leader feedback meeting falls on a different
// weekday — confirmed by the user 2026-07-21: Análisis de Mercado (Bryan)
// martes, Fulfillment/Inventario jueves, Diseño - Marketing (Marcos)
// viernes. Anything not listed here defaults to Monday in
// weeklyPendingStatus. Update this map if a meeting day ever changes.
const FEEDBACK_REVIEW_WEEKDAY: Record<string, number> = {
  MKT: 2,
  FUL: 4,
  INV: 4,
  DIS: 5,
};

// Departments the admin meets only once a month instead of weekly —
// confirmed by the user 2026-07-21: Finanzas y Contabilidad (Nairoby), the
// 4th Thursday of every month. Handled via monthlyReviewStatus instead of
// weeklyPendingStatus/FEEDBACK_REVIEW_WEEKDAY.
const FEEDBACK_MONTHLY_REVIEW: Record<string, { weekday: number; occurrence: number }> = {
  FIN: { weekday: 4, occurrence: 4 },
};

// ---------------- Per-source checks ----------------
async function getFeedbackPendingItems(): Promise<PendingItem[]> {
  // A department with no active leader has nobody to have the admin-leader
  // feedback meeting with — nothing to report, so it shouldn't nag admin
  // with a reminder either. Starts showing up automatically once someone
  // is marked as that department's leader.
  const depts = await prisma.department.findMany({
    where: { trackWeeklyReview: true, leaders: { some: { isLeader: true, isActive: true } } },
    select: { id: true, name: true, code: true },
    orderBy: { order: "asc" },
  });

  const items: PendingItem[] = [];
  for (const d of depts) {
    const monthlyCfg = FEEDBACK_MONTHLY_REVIEW[d.code];
    const existsFn = async (week: string) => {
      const count = await prisma.weeklyReviewRecord.count({ where: { deptId: d.id, week } });
      return count > 0;
    };

    if (monthlyCfg) {
      const status = await monthlyReviewStatus(existsFn, monthlyCfg.weekday, monthlyCfg.occurrence);
      if (status) {
        items.push({
          type: "feedback",
          icon: "📝",
          label: `Feedback mensual — ${d.name}`,
          meta: `${formatMonthLabel(status.month)} · atrasado`,
          overdue: status.overdue,
          href: `/admin/dept/${d.id}`,
        });
      }
      continue;
    }

    const status = await weeklyPendingStatus(existsFn, FEEDBACK_REVIEW_WEEKDAY[d.code] ?? 1);
    if (status) {
      items.push({
        type: "feedback",
        icon: "📝",
        label: `Feedback semanal — ${d.name}`,
        meta: `${formatWeekLabel(status.week)} · atrasado`,
        overdue: status.overdue,
        href: `/admin/dept/${d.id}`,
      });
    }
  }
  return items;
}

async function getWeeklyMetricPendingItem(deptId: string, href: string): Promise<PendingItem | null> {
  const status = await weeklyPendingStatus(async (week) => {
    const rec = await prisma.weeklyMetricRecord.findUnique({ where: { deptId_week: { deptId, week } } });
    return !!rec;
  });
  if (!status) return null;
  return {
    type: "pedidos_despachados",
    icon: "📦",
    label: "Pedidos despachados / Fill Rate",
    meta: `${formatWeekLabel(status.week)} · atrasado`,
    overdue: status.overdue,
    href,
  };
}

async function getStockoutPendingItem(href: string): Promise<PendingItem | null> {
  const status = await weeklyPendingStatus(async (week) => {
    const [productCount, confirmed] = await Promise.all([
      prisma.stockoutWeekProduct.count({ where: { week } }),
      prisma.stockoutWeekConfirmation.findUnique({ where: { week } }),
    ]);
    return productCount > 0 || !!confirmed;
  });
  if (!status) return null;
  return {
    type: "ruptura_stock",
    icon: "🗃️",
    label: "Ruptura de Stock",
    meta: `${formatWeekLabel(status.week)} · atrasado`,
    overdue: status.overdue,
    href,
  };
}

async function countMissingPayStubs(month: number, year: number): Promise<number> {
  const [activeUsers, stubs] = await Promise.all([
    prisma.user.findMany({ where: { isActive: true }, select: { id: true } }),
    prisma.payStub.findMany({ where: { month, year }, select: { userId: true } }),
  ]);
  const stubUserIds = new Set(stubs.map((s) => s.userId));
  return activeUsers.filter((u) => !stubUserIds.has(u.id)).length;
}

// Only surfaces once the fixed check-in day for the current month has
// passed (día 3, confirmed 2026-07-22) and people are still missing — no
// early heads-up before then.
async function getPayStubPendingItem(href: string): Promise<PendingItem | null> {
  const today = currentMonthStr();
  const prev = prevMonthStr(today);

  if (fixedDayDeadlinePassed(today, 3)) {
    const [py, pm] = prev.split("-").map(Number);
    const missing = await countMissingPayStubs(pm, py);
    if (missing > 0) {
      return {
        type: "roles_de_pago",
        icon: "💳",
        label: "Roles de pago",
        meta: `Faltan ${missing} persona${missing === 1 ? "" : "s"} · ${formatMonthLabel(prev)} · atrasado`,
        overdue: true,
        href,
      };
    }
  }
  return null;
}

// Fixed check-in day for the current month (día 4, confirmed 2026-07-22),
// same pattern as getPayStubPendingItem.
async function getReturnRatePendingItem(href: string): Promise<PendingItem | null> {
  const today = currentMonthStr();
  const prev = prevMonthStr(today);
  if (fixedDayDeadlinePassed(today, 4) && !(await prisma.returnRateRecord.findUnique({ where: { month: prev } }))) {
    return {
      type: "tasa_devolucion",
      icon: "📉",
      label: "Tasa de Devolución General",
      meta: `${formatMonthLabel(prev)} · atrasado`,
      overdue: true,
      href,
    };
  }
  return null;
}

// Confirmed 2026-07-22: Garantías starts on the first business day of the
// current month (día 1, rolled forward past Sunday/holidays) — reviewing
// the previous month's data, same fixedDayDeadlinePassed mechanism as the
// other two, just anchored to día 1 instead of a later fixed day.
async function getWarrantyPendingItem(href: string): Promise<PendingItem | null> {
  const today = currentMonthStr();
  const prev = prevMonthStr(today);
  if (fixedDayDeadlinePassed(today, 1) && !(await prisma.warrantyMonthTotal.findUnique({ where: { month: prev } }))) {
    return {
      type: "kpi_garantias",
      icon: "🛡️",
      label: "KPI de Garantías",
      meta: `${formatMonthLabel(prev)} · atrasado`,
      overdue: true,
      href,
    };
  }
  return null;
}

// Each active payment reminder has its own reminderStartDay (día del mes
// desde el cual empieza a recordar, confirmed 2026-07-22). Several can be
// pending at once, unlike the other Finance checks. Shows the reference
// amount (confirmed 2026-07-22) when one is set, so admin/Nairoby can see
// how much is owed right from the Inicio pendientes card, not just inside
// the tab.
async function getPaymentReminderPendingItems(deptId: string, href: string): Promise<PendingItem[]> {
  const reminders = await prisma.paymentReminder.findMany({ where: { deptId, isActive: true } });
  if (reminders.length === 0) return [];

  const period = currentMonthStr();
  const now = nowInEcuador();
  const items: PendingItem[] = [];

  for (const r of reminders) {
    const startDate = nthDayOfMonthClamped(period, r.reminderStartDay);
    if (now < startDate) continue;
    const record = await prisma.paymentReminderRecord.findUnique({
      where: { reminderId_period: { reminderId: r.id, period } },
    });
    if (record) continue;
    const amountLabel = r.amount != null ? ` · $${r.amount.toFixed(2)}` : "";
    items.push({
      type: "pagos_recordatorios",
      icon: "💳",
      label: r.name,
      meta: `Vence el día ${r.dueDay}${amountLabel}${r.paymentMethod ? " · " + r.paymentMethod : ""} · atrasado`,
      overdue: true,
      href,
    });
  }
  return items;
}

// Servicio Postventa — confirmed 2026-07-22: Nairoby evaluates tiendas the
// 2nd week of the month (starting the 2nd Wednesday), reviewing the previous
// month. Only needs at least one evaluation logged for that period — she
// doesn't have to cover every store, just start the round.
//
// Confirmado 2026-07-28: julio 2026 no cuenta — recién van a empezar a
// hacer esto en agosto. No debe aparecer ningún pendiente/notificación de
// este tema (ni en la tarjeta de Pendientes ni por push) antes de ese mes.
const STORE_FEEDBACK_START_MONTH = "2026-08";

async function getStoreFeedbackPendingItem(href: string): Promise<PendingItem | null> {
  const today = currentMonthStr();
  if (today < STORE_FEEDBACK_START_MONTH) return null;

  const prev = prevMonthStr(today);
  const startDate = nthWeekdayOfMonth(today, 3, 2); // 3 = miércoles, 2da ocurrencia
  if (nowInEcuador() < startDate) return null;

  const hasAny = await prisma.storeFeedbackEvaluation.count({ where: { period: prev } });
  if (hasAny > 0) return null;

  return {
    type: "servicio_postventa",
    icon: "🏬",
    label: "Servicio Postventa — feedback de tiendas",
    meta: `${formatMonthLabel(prev)} · atrasado`,
    overdue: true,
    href,
  };
}

// "Colaborador del mes" — confirmado 2026-08-05: a diferencia de los demás
// pendientes de este archivo (que solo avisan una vez atrasados), este
// empieza a avisar ANTES del plazo (últimos 5 días calendario del mes) para
// dar tiempo real de calificar a todo el equipo antes de que cierre — el
// objetivo es que el ganador del mes se sepa antes del día 7 del mes
// siguiente, no solo detectar el atraso después de que ya pasó.
const RECOGNITION_LEADER_HEADS_UP_DAYS = 5;

async function getMissingEvaluatees(evaluatorIsAdmin: boolean, leaderDeptId: string | null, month: string) {
  const where = evaluatorIsAdmin
    ? { isLeader: true as const, isActive: true, excludeFromRecognition: false }
    : { deptId: leaderDeptId!, isLeader: false as const, isActive: true, excludeFromRecognition: false };
  const evaluatees = await prisma.user.findMany({ where, select: { id: true, name: true } });
  if (evaluatees.length === 0) return [];
  const done = await prisma.monthlyEvaluation.findMany({
    where: { month, evaluateeId: { in: evaluatees.map((u) => u.id) } },
    select: { evaluateeId: true },
  });
  const doneIds = new Set(done.map((e) => e.evaluateeId));
  return evaluatees.filter((u) => !doneIds.has(u.id));
}

// One per leader (any department) — Bryan/Nairoby/Daniel/etc. all evaluate
// their own team monthly, regardless of what other pending items they have.
async function getRecognitionLeaderPendingItem(leaderDeptId: string, href: string): Promise<PendingItem | null> {
  const month = currentMonthStr();
  const deadline = evaluationDeadline(month);
  const now = nowInEcuador();
  const headsUpStart = new Date(deadline.getTime() - RECOGNITION_LEADER_HEADS_UP_DAYS * 86400000);
  if (now < headsUpStart) return null;

  const missing = await getMissingEvaluatees(false, leaderDeptId, month);
  if (missing.length === 0) return null;

  const overdue = now >= deadline;
  const names = missing.slice(0, 3).map((u) => u.name).join(", ") + (missing.length > 3 ? ` y ${missing.length - 3} más` : "");
  return {
    type: "colaborador_del_mes",
    icon: "🏆",
    label: "Colaborador del mes — calificar a tu equipo",
    meta: `Faltan ${missing.length}: ${names} · ${formatMonthLabel(month)}${overdue ? " · atrasado" : ""}`,
    overdue,
    href,
  };
}

// Para el admin — a diferencia del resto de "Pendientes de esta semana"
// (feedback), este mira los últimos 2 meses (el actual recién cerrado y el
// anterior, por si quedó pendiente) y solo aparece una vez que el plazo de
// los líderes ya venció, listando exactamente a quién le falta — no un
// aviso genérico. Se pone "atrasado" (urgente) cuando ya pasó el plazo de 5
// días hábiles que el admin tiene para confirmar (~día 7).
async function getRecognitionAdminPendingItem(href: string): Promise<PendingItem | null> {
  const now = nowInEcuador();
  const cur = currentMonthStr();
  const prev = prevMonthStr(cur);

  for (const month of [prev, cur]) {
    const deadline = evaluationDeadline(month);
    if (now < deadline) continue;
    const alreadyConfirmed = await prisma.monthlyRecognitionResult.findFirst({ where: { month } });
    if (alreadyConfirmed) continue;

    // Non-leaders span every department, so this checks all of them at once
    // instead of the per-leader-deptId helper used elsewhere in this file.
    const [missingLeaders, nonLeaders] = await Promise.all([
      getMissingEvaluatees(true, null, month),
      prisma.user.findMany({
        where: { isLeader: false, isActive: true, excludeFromRecognition: false },
        select: { id: true, name: true },
      }),
    ]);
    const doneNonLeaders = await prisma.monthlyEvaluation.findMany({
      where: { month, evaluateeId: { in: nonLeaders.map((u) => u.id) } },
      select: { evaluateeId: true },
    });
    const doneNonLeaderIds = new Set(doneNonLeaders.map((e) => e.evaluateeId));
    const missingTeam = nonLeaders.filter((u) => !doneNonLeaderIds.has(u.id));
    const missing = [...missingLeaders, ...missingTeam];
    if (missing.length === 0) continue;

    const overdue = now >= adminConfirmDeadline(month);
    const names = missing.slice(0, 4).map((u) => u.name).join(", ") + (missing.length > 4 ? ` y ${missing.length - 4} más` : "");
    return {
      type: "colaborador_del_mes",
      icon: "🏆",
      label: "Colaborador del mes — falta calificar/confirmar",
      meta: `Faltan ${missing.length}: ${names} · ${formatMonthLabel(month)}${overdue ? " · atrasado" : ""}`,
      overdue,
      href,
    };
  }
  return null;
}

// Confirmado 2026-08-05: el aviso de saldo bajo le llega tanto a admin como
// a Nairoby (líder de Finanzas) — cualquiera de los dos puede recargar.
async function getPettyCashLowBalanceItems(href: string): Promise<PendingItem[]> {
  const boxes: { label: string; type: PettyCashBoxTypeStr }[] = [
    { label: "Principal", type: "PRINCIPAL" },
    { label: "Secundaria", type: "SECUNDARIA" },
  ];
  const items: PendingItem[] = [];
  for (const b of boxes) {
    const box = await getPettyCashBoxData(b.type);
    if (box.isLow) {
      items.push({
        type: "caja_chica_saldo",
        icon: "💰",
        label: `Caja Chica ${b.label} con saldo bajo`,
        meta: `$${box.balance.toFixed(2)} · mínimo $${box.minThreshold.toFixed(2)} · atrasado`,
        overdue: true,
        href,
      });
    }
  }
  return items;
}

// Confirmado 2026-08-05: si quien recibió una recarga no la confirma dentro
// de 8 horas laborables (horario real, src/lib/businessHours.ts), se avisa
// a quien la fondeó — admin ve las suyas (createdById null), Nairoby ve las
// que ella misma fondeó a la Secundaria de Bryan.
async function getPettyCashUnconfirmedFunderItems(funderId: string | null, href: string): Promise<PendingItem[]> {
  const rows = await prisma.pettyCashEntry.findMany({
    where: { kind: "RECARGA", confirmedAt: null, archived: false, createdById: funderId },
    include: { box: true },
  });
  const now = nowInEcuador();
  const items: PendingItem[] = [];
  for (const r of rows) {
    if (now < addBusinessHours(r.createdAt, 8)) continue;
    items.push({
      type: "caja_chica_confirmacion",
      icon: "🔒",
      label: `${r.box.type === "PRINCIPAL" ? "Nairoby" : "Bryan"} no ha confirmado tu recarga`,
      meta: `$${r.amount.toFixed(2)} · pendiente hace más de 8h laborables · atrasado`,
      overdue: true,
      href,
    });
  }
  return items;
}

// Confirmado 2026-08-06: aviso 1 día antes de la fecha en que se va a
// felicitar (que puede ser el cumpleaños real o el último día laborable
// antes, si cae sábado/domingo/feriado — ver celebrationDateFor en
// birthdays.ts). Sin deptId = vista del admin, toda la empresa; con deptId,
// la del líder de esa área (excluyendo su propio cumpleaños, no tiene
// sentido que se autorecuerde felicitarse a sí mismo).
async function getUpcomingBirthdayPendingItems(href: string, deptId?: string, excludeUserId?: string): Promise<PendingItem[]> {
  const upcoming = await getUpcomingBirthdays(deptId);
  return upcoming
    .filter((u) => u.id !== excludeUserId)
    .map((u) => ({
      type: "cumpleanos",
      icon: "🎂",
      label: `Cumpleaños de ${u.name}`,
      meta: `${u.deptName ?? ""} · mañana`.trim(),
      overdue: false,
      href,
    }));
}

// ---------------- Entry point ----------------
// Each person only ever sees what's specifically assigned to them — admin
// gets Feedback semanal (the one thing only admin can write), a department
// leader gets whichever of Roles de pago/Devolución/Garantías (Finanzas),
// Pedidos despachados (whoever leads the trackWeeklyMetric department), or
// Ruptura de Stock (Inventario) applies to them. Nobody sees anyone else's.
//
// Split into "for a given actor" (no session dependency, reusable from the
// push-notification cron sweep, which runs with nobody logged in) and "for
// the current session" (the original entry point, used by every page).
export type PendingTasksActor = { isAdmin: true } | { isAdmin: false; userId: string };

export async function getPendingTasksForActor(actor: PendingTasksActor): Promise<PendingTasks | null> {
  if (actor.isAdmin) {
    const [feedbackItems, recognitionItem, pettyCashLow, pettyCashUnconfirmed, birthdayItems] = await Promise.all([
      getFeedbackPendingItems(),
      getRecognitionAdminPendingItem("/admin/colaborador-destacado"),
      getPettyCashLowBalanceItems("/admin"),
      getPettyCashUnconfirmedFunderItems(null, "/admin"),
      getUpcomingBirthdayPendingItems("/admin/nomina"),
    ]);
    const items = [...feedbackItems, ...(recognitionItem ? [recognitionItem] : []), ...pettyCashLow, ...pettyCashUnconfirmed, ...birthdayItems];
    if (items.length === 0) return null;
    return { title: "Pendientes de esta semana", sub: "Como administrador", items };
  }

  const me = await prisma.user.findUnique({
    where: { id: actor.userId },
    select: {
      isLeader: true,
      leadsDeptId: true,
      leadsDept: { select: { code: true, name: true, trackWeeklyMetric: true } },
    },
  });
  if (!me?.isLeader || !me.leadsDeptId || !me.leadsDept) return null;

  const items: PendingItem[] = [];
  let monthly = false;

  if (me.leadsDept.code === "FIN") {
    monthly = true;
    const [payStub, returnRate, warranty, paymentReminders, storeFeedback, pettyCashLow, pettyCashUnconfirmed] = await Promise.all([
      getPayStubPendingItem("/area/roles-de-pago"),
      getReturnRatePendingItem("/area/kpis-generales"),
      getWarrantyPendingItem("/area/kpis-generales"),
      getPaymentReminderPendingItems(me.leadsDeptId, "/area/workspace"),
      getStoreFeedbackPendingItem("/area/kpis-generales"),
      getPettyCashLowBalanceItems("/area/workspace"),
      getPettyCashUnconfirmedFunderItems(actor.userId, "/area/workspace"),
    ]);
    items.push(...pettyCashLow, ...pettyCashUnconfirmed);
    if (payStub) items.push(payStub);
    if (returnRate) items.push(returnRate);
    if (warranty) items.push(warranty);
    items.push(...paymentReminders);
    if (storeFeedback) items.push(storeFeedback);
  }

  if (me.leadsDept.trackWeeklyMetric) {
    const item = await getWeeklyMetricPendingItem(me.leadsDeptId, "/area/workspace");
    if (item) items.push(item);
  }

  if (me.leadsDept.code === "INV") {
    const item = await getStockoutPendingItem("/area/kpis-generales");
    if (item) items.push(item);
  }

  const recognitionItem = await getRecognitionLeaderPendingItem(me.leadsDeptId, "/area/colaborador-destacado");
  if (recognitionItem) items.push(recognitionItem);

  // Confirmado 2026-08-06: aplica a CUALQUIER líder, no solo Finanzas — su
  // propio equipo puede tener un cumpleaños mañana sin importar el área.
  const birthdayItems = await getUpcomingBirthdayPendingItems("/area/nomina", me.leadsDeptId, actor.userId);
  items.push(...birthdayItems);

  if (items.length === 0) return null;
  return {
    title: monthly ? "Pendientes de este mes" : "Pendientes de esta semana",
    sub: `Como líder de ${me.leadsDept.name}`,
    items,
  };
}

export async function getPendingTasksForCurrentUser(): Promise<PendingTasks | null> {
  const session = await auth();
  if (!session) return null;
  return getPendingTasksForActor(
    session.user.role === "admin" ? { isAdmin: true } : { isAdmin: false, userId: session.user.id }
  );
}

// Qué tipos de pendiente podrían ALGUNA VEZ aplicarle a este actor — a
// diferencia de getPendingTasksForActor, no depende de si algo está
// vencido ahora mismo, así la persona puede configurar sus preferencias de
// notificación push desde el día uno, antes de que exista ningún atrasado.
export async function getPossiblePendingTypesForActor(
  actor: PendingTasksActor
): Promise<{ type: string; label: string }[]> {
  const types: string[] = [];

  if (actor.isAdmin) {
    types.push("feedback", "caja_chica_saldo", "caja_chica_confirmacion", "cumpleanos");
  } else {
    const me = await prisma.user.findUnique({
      where: { id: actor.userId },
      select: { isLeader: true, leadsDeptId: true, leadsDept: { select: { code: true, trackWeeklyMetric: true } } },
    });
    if (!me?.isLeader || !me.leadsDeptId || !me.leadsDept) return [];

    types.push("cumpleanos");
    if (me.leadsDept.code === "FIN") {
      types.push("roles_de_pago", "tasa_devolucion", "kpi_garantias", "pagos_recordatorios", "servicio_postventa", "caja_chica_saldo", "caja_chica_confirmacion");
    }
    if (me.leadsDept.trackWeeklyMetric) types.push("pedidos_despachados");
    if (me.leadsDept.code === "INV") types.push("ruptura_stock");
  }

  return types.map((type) => ({ type, label: PENDING_TYPE_CATALOG[type] }));
}

// Todo actor que alguna vez podría tener algo en "Pendientes" — admin
// siempre, más cada líder activo con un área a cargo. Usado por el barrido
// del cron de notificaciones push (corre sin nadie con sesión iniciada).
export async function getAllPendingTasksActors(): Promise<{ ownerId: string; actor: PendingTasksActor }[]> {
  const leaders = await prisma.user.findMany({
    where: { isLeader: true, isActive: true, leadsDeptId: { not: null } },
    select: { id: true },
  });
  return [
    { ownerId: "admin", actor: { isAdmin: true } as const },
    ...leaders.map((l) => ({ ownerId: l.id, actor: { isAdmin: false as const, userId: l.id } })),
  ];
}
