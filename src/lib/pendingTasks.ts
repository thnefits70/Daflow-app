import { auth } from "@/auth";
import { prisma } from "@/lib/prisma";
import { isFixedHoliday, evaluationDeadline, adminConfirmDeadline } from "@/lib/recognition";
import { addBusinessHours } from "@/lib/businessHours";
import { getPettyCashBoxData, type PettyCashBoxTypeStr } from "@/lib/pettyCash";
import { getUpcomingBirthdays } from "@/lib/birthdays";
import { getFinanzasDeptId, recentInventorySnapshotPeriods, isSnapshotPeriodOverdue, snapshotPeriodLabel } from "@/lib/inventoryKpis";
import { isEndOfMonthQuincena, monthOfPeriod } from "@/lib/payrollCalc";
import { getMarketingLeadId } from "@/lib/guards";

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

export function formatMonthLabel(month: string) {
  const [y, m] = month.split("-");
  return `${MONTH_ABBR[Number(m) - 1]} ${y.slice(2)}`;
}

function currentMonthStr(): string {
  const d = nowInEcuador();
  return `${d.getUTCFullYear()}-${pad2(d.getUTCMonth() + 1)}`;
}

export function prevMonthStr(month: string): string {
  const [y, m] = month.split("-").map(Number);
  const d = new Date(Date.UTC(y, m - 2, 1));
  return `${d.getUTCFullYear()}-${pad2(d.getUTCMonth() + 1)}`;
}

// Last UTC instant of `month` — used to test whether someone had already
// been hired (startDate) by the time a given past month happened, so people
// who joined later don't count toward that month's requirement.
function monthEndUTC(month: string): Date {
  const [y, m] = month.split("-").map(Number);
  return new Date(Date.UTC(y, m, 0, 23, 59, 59, 999));
}

// Fix confirmado 2026-08-25 (reportado por Daniel): quién "cuenta" para
// completar un mes pasado no puede ser la plantilla ACTUAL del equipo — si
// alguien se sumó después de ese mes (ej. Bryan Franco, ingresó 2026-07-20),
// exigirle una calificación de junio no tiene sentido y obligaba al líder a
// inventarse un 0/0/0 solo para destrabar el mes siguiente, con el mismo
// problema repitiéndose hacia atrás cada vez que se sume gente nueva. Si no
// hay startDate registrada, se lo sigue incluyendo (no hay forma de saber si
// ya estaba) — mismo comportamiento que antes.
function eligibleForMonth<T extends { startDate: Date | null }>(cohort: T[], month: string): T[] {
  const end = monthEndUTC(month);
  return cohort.filter((u) => !u.startDate || u.startDate <= end);
}

// Confirmado 2026-08-07: metodología estricta mes por mes — no se puede
// calificar un mes si el evaluador (líder o admin) todavía tiene gente sin
// calificar de un mes ANTERIOR (ej. no se puede calificar agosto si julio
// se quedó incompleto). Recorre hacia atrás desde el mes objetivo hasta el
// mes más antiguo con algún registro para este mismo grupo de evaluados —
// nunca más atrás, así no se traba por meses de antes de que este grupo
// existiera. Usa monthlyEvaluationSummary (no el detalle, que se purga con
// el tiempo) porque el resumen es el registro permanente de "esto ya se
// calificó" — se escribe siempre junto con la evaluación detallada.
export async function getEarliestIncompleteMonthBefore(
  evaluatorIsAdmin: boolean,
  leaderDeptId: string | null,
  targetMonth: string
): Promise<string | null> {
  const where = evaluatorIsAdmin
    ? { isLeader: true as const, isActive: true, excludeFromRecognition: false }
    : { deptId: leaderDeptId!, isLeader: false as const, isActive: true, excludeFromRecognition: false };
  const cohort = await prisma.user.findMany({ where, select: { id: true, startDate: true } });
  if (cohort.length === 0) return null;
  const cohortIds = cohort.map((u) => u.id);

  const genesis = await prisma.monthlyEvaluationSummary.findFirst({
    where: { evaluateeId: { in: cohortIds } },
    orderBy: { month: "asc" },
    select: { month: true },
  });
  if (!genesis) return null; // este grupo nunca tuvo ninguna evaluación — nada que bloquear

  let month = prevMonthStr(targetMonth);
  while (month >= genesis.month) {
    const eligibleIds = eligibleForMonth(cohort, month).map((u) => u.id);
    if (eligibleIds.length > 0) {
      const done = await prisma.monthlyEvaluationSummary.count({ where: { month, evaluateeId: { in: eligibleIds } } });
      if (done < eligibleIds.length) return month;
    }
    month = prevMonthStr(month);
  }
  return null;
}

function nextMonthStr(month: string): string {
  const [y, m] = month.split("-").map(Number);
  const d = new Date(Date.UTC(y, m, 1));
  return `${d.getUTCFullYear()}-${pad2(d.getUTCMonth() + 1)}`;
}

// Confirmado 2026-08-07: plazo duro pedido explícitamente por el usuario —
// calificar el mes M vence el día 5 (calendario) del mes siguiente. A
// diferencia de evaluationDeadline() (fin del mes M, usada solo como aviso
// informativo/heads-up), este plazo es el que dispara el bloqueo total de
// cuenta si se pasa sin completar.
function evaluationHardDeadline(month: string): Date {
  const next = nextMonthStr(month);
  const [y, m] = next.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, 5, 23, 59, 59));
}

export type RecognitionLockout = { month: string; deadline: string };

// Fix confirmado 2026-08-07: bug real — la primera versión reusaba
// getEarliestIncompleteMonthBefore, que recorre hacia atrás hasta el mes más
// viejo con CUALQUIER registro para el grupo (el "genesis"). Eso significa
// que un hueco viejo (ej. un líder que todavía no existía o no se evaluó en
// un mes de hace tiempo, antes de que esta metodología se aplicara en serio)
// bloqueaba para siempre, aunque el mes que de verdad importa (el anterior
// al actual) ya estuviera completo — pasó de verdad: julio ya estaba
// calificado para los 5 líderes pero igual bloqueaba por un mes anterior a
// julio. El bloqueo SOLO debe mirar el mes inmediatamente anterior al
// actual — nunca más atrás — para no arrastrar huecos históricos.
export async function getRecognitionLockout(evaluatorIsAdmin: boolean, leaderDeptId: string | null): Promise<RecognitionLockout | null> {
  const now = nowInEcuador();
  const month = prevMonthStr(currentMonthStr());
  const deadline = evaluationHardDeadline(month);
  if (now <= deadline) return null;

  const where = evaluatorIsAdmin
    ? { isLeader: true as const, isActive: true, excludeFromRecognition: false }
    : { deptId: leaderDeptId!, isLeader: false as const, isActive: true, excludeFromRecognition: false };
  const cohort = await prisma.user.findMany({ where, select: { id: true, startDate: true } });
  if (cohort.length === 0) return null;
  const eligible = eligibleForMonth(cohort, month);
  if (eligible.length === 0) return null;

  const done = await prisma.monthlyEvaluationSummary.count({ where: { month, evaluateeId: { in: eligible.map((u) => u.id) } } });
  if (done >= eligible.length) return null;
  return { month, deadline: deadline.toISOString() };
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

function rollToPreviousBusinessDay(date: Date): Date {
  let d = date;
  while (!isCompanyBusinessDay(d)) d = new Date(d.getTime() - 86400000);
  return d;
}

// Confirmado 2026-08-23: fecha real de pago de una quincena — el 15 (Q1) o
// el último día calendario del mes (Q2/fin de mes), corrido al día hábil
// ANTERIOR si cae domingo/feriado (nunca al siguiente — a diferencia de
// fixedDayDeadlinePassed arriba, acá lo que importa es cuándo hay que tener
// la plata transferida, no cuándo empieza a valer un aviso).
function payDateForPeriod(period: string): Date {
  const [y, m, q] = period.split("-");
  if (q === "Q1") return rollToPreviousBusinessDay(nthDayOfMonth(`${y}-${m}`, 15));
  const lastDay = new Date(Date.UTC(Number(y), Number(m), 0)).getUTCDate();
  return rollToPreviousBusinessDay(nthDayOfMonth(`${y}-${m}`, lastDay));
}

function businessDaysBefore(date: Date, n: number): Date {
  let d = date;
  let counted = 0;
  while (counted < n) {
    d = new Date(d.getTime() - 86400000);
    if (isCompanyBusinessDay(d)) counted++;
  }
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
  nomina_transferencia: "Transferencia de nómina",
  iess_transferencia: "Transferencia de IESS",
  tasa_devolucion: "Tasa de Devolución General",
  kpi_garantias: "KPI de Garantías",
  pagos_recordatorios: "Pagos recordatorios",
  servicio_postventa: "Servicio Postventa",
  pedidos_despachados: "Pedidos despachados / Fill Rate",
  ruptura_stock: "Ruptura de Stock",
  caja_chica_saldo: "Caja Chica — saldo bajo",
  caja_chica_confirmacion: "Caja Chica — falta que confirmen una recarga",
  pagos_administrativos: "Pagos administrativos pendientes de pago",
  pagos_mercaderia: "Pagos de mercadería pendientes",
  pagos_flete: "Fletes pendientes de pago",
  horas_extra_aprobacion: "Horas extra por aprobar",
  comisiones_bonos_aprobacion: "Comisiones y bonos por aprobar",
  anticipos_aprobacion: "Anticipos por aprobar",
  descuentos_sin_aceptar: "Descuentos por mala gestión sin aceptar",
  mis_descuentos_pendientes: "Tus descuentos por mala gestión — falta aceptar",
  mi_cuenta_bancaria: "Tu cuenta bancaria — falta registrarla",
  compras_personales_confirmar: "Compras personales — falta confirmar producto/cantidad",
  compras_personales_precio: "Compras personales — falta cerrar el precio",
  compras_personales_transferencia: "Compras personales — comprobante por confirmar",
  compras_personales_cierre: "Compras personales — transferencia confirmada, falta cerrar",
  compras_personales_metodo_pago: "Tus compras personales — falta que elijas cómo pagar o subas el comprobante",
  compras_personales_estado: "Tus compras personales — seguimiento del estado (mientras esperás a bodega o Finanzas)",
  compras_personales_pago_seguimiento: "Compras personales — seguimiento de pagos pendientes del colaborador",
  reingreso_mercaderia_revision: "Reingreso de mercadería por revisar",
  reingreso_mercaderia_baja_just: "Reingreso de mercadería — semana de dañados por dar de baja en Just",
  reingreso_mercaderia_verificacion_semanal: "Reingreso de mercadería — lote semanal de dañados por verificar",
  cumpleanos: "Cumpleaños de tu equipo (aviso 1 día antes)",
  compras_rechazadas: "Tus solicitudes de compra rechazadas — corregir y reenviar",
  compras_orden_compra: "Tus solicitudes de compra — falta subir orden de compra",
  compras_transportista: "Tus solicitudes de compra — falta transportista",
  compras_cuenta_bancaria: "Tus solicitudes de compra — cambiar cuenta bancaria",
  compras_recepcion: "Control de Compras — confirmar mercadería recibida",
  compras_cambios_verificar: "Control de Compras — verificar cambios de mercadería",
  compras_reclamo_posterior_revision: "Reclamos posteriores al cierre por revisar",
  compras_reclamo_posterior_just: "Reclamos posteriores al cierre por dar de baja en Just",
  compras_creditos_pendientes: "Créditos pendientes de recuperar",
  control_inventario: "Control de Inventario — captura mensual",
  control_inventario_semanal: "Control de Inventario — Excel semanal de stock por SKU",
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

// Confirmado 2026-08-12: pedido explícito del usuario — el feedback es del
// mes que acaba de pasar, así que recién tiene sentido pedirlo después del
// día 15 del mes actual (antes de eso, ni siquiera ha pasado la mitad del
// mes que se está evaluando en la práctica de Nairoby). Mismo patrón de
// "día fijo del mes, con corrimiento a día hábil" que ya usa Roles de
// pago/Devolución/Garantías — antes usaba el 3er miércoles, cambiado acá.
async function getStoreFeedbackPendingItem(href: string): Promise<PendingItem | null> {
  const today = currentMonthStr();
  if (today < STORE_FEEDBACK_START_MONTH) return null;

  const prev = prevMonthStr(today);
  if (!fixedDayDeadlinePassed(today, 15)) return null;

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
  const evaluatees = await prisma.user.findMany({ where, select: { id: true, name: true, startDate: true } });
  const eligible = eligibleForMonth(evaluatees, month);
  if (eligible.length === 0) return [];
  const done = await prisma.monthlyEvaluation.findMany({
    where: { month, evaluateeId: { in: eligible.map((u) => u.id) } },
    select: { evaluateeId: true },
  });
  const doneIds = new Set(done.map((e) => e.evaluateeId));
  return eligible.filter((u) => !doneIds.has(u.id));
}

// One per leader (any department) — Bryan/Nairoby/Daniel/etc. all evaluate
// their own team monthly, regardless of what other pending items they have.
// Fix confirmado 2026-08-07: antes solo miraba el mes ACTUAL, así que en
// cuanto el calendario cambiaba de mes, un mes anterior que se quedó
// incompleto (ej. julio sin calificar todavía, ya en agosto) dejaba de
// avisar para siempre — nunca se marcaba "atrasado", simplemente
// desaparecía del radar del líder. Ahora revisa el mes anterior primero (si
// su plazo ya venció, siempre es más urgente) y el actual después (solo
// dentro de la ventana de aviso previo al plazo) — mismo patrón de dos
// meses que ya usa getRecognitionAdminPendingItem más abajo.
async function getRecognitionLeaderPendingItem(leaderDeptId: string, href: string): Promise<PendingItem | null> {
  const now = nowInEcuador();
  const cur = currentMonthStr();
  const prev = prevMonthStr(cur);

  for (const month of [prev, cur]) {
    const deadline = evaluationDeadline(month);
    if (month === cur) {
      const headsUpStart = new Date(deadline.getTime() - RECOGNITION_LEADER_HEADS_UP_DAYS * 86400000);
      if (now < headsUpStart) continue;
    } else if (now < deadline) {
      continue;
    }

    const missing = await getMissingEvaluatees(false, leaderDeptId, month);
    if (missing.length === 0) continue;

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
  return null;
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
    const [missingLeaders, nonLeadersAll] = await Promise.all([
      getMissingEvaluatees(true, null, month),
      prisma.user.findMany({
        where: { isLeader: false, isActive: true, excludeFromRecognition: false },
        select: { id: true, name: true, startDate: true },
      }),
    ]);
    const nonLeaders = eligibleForMonth(nonLeadersAll, month);
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
// Confirmado 2026-08-06: el link "Ir →" debe llevar directo a la pestaña
// "Caja Chica" y hacer scroll+resaltado sobre la caja específica (Principal
// o Secundaria) — no solo a la página general — así que hrefBase (la página
// de destino, sin query) se recibe ya resuelta por el llamador y acá solo se
// le agregan los parámetros que DeptWorkspaceTabs/PettyCashPanel leen.
async function getPettyCashLowBalanceItems(hrefBase: string): Promise<PendingItem[]> {
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
        href: `${hrefBase}?tab=cajachica&box=${b.type.toLowerCase()}`,
      });
    }
  }
  return items;
}

// Confirmado 2026-08-05: si quien recibió una recarga no la confirma dentro
// de 8 horas laborables (horario real, src/lib/businessHours.ts), se avisa
// a quien la fondeó — admin ve las suyas (createdById null), Nairoby ve las
// que ella misma fondeó a la Secundaria de Bryan.
async function getPettyCashUnconfirmedFunderItems(funderId: string | null, hrefBase: string): Promise<PendingItem[]> {
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
      href: `${hrefBase}?tab=cajachica&box=${r.box.type.toLowerCase()}`,
    });
  }
  return items;
}

// Confirmado 2026-08-12: pedido explícito del usuario — un enlace de un
// clic en Inicio cuando el admin tiene pagos administrativos esperando que
// suba el comprobante. Mismo umbral de 24h que ya usa el cron de push
// (getStaleAdminPaymentPushes en adminPayments.ts) para marcarlo "atrasado".
// Desaparece solo apenas la solicitud deja de estar PENDING_PAYMENT — eso
// solo pasa cuando se sube un comprobante y la IA lo verifica correcto (ver
// AdminPaymentsPanel.tsx / api/admin-payments/[id]/upload-proof), nunca
// antes.
async function getAdminPaymentsPendingItem(href: string): Promise<PendingItem | null> {
  const pending = await prisma.adminPaymentRequest.findMany({
    where: { status: "PENDING_PAYMENT" },
    select: { monto: true, createdAt: true },
  });
  if (pending.length === 0) return null;
  const cutoff = new Date(Date.now() - 24 * 60 * 60 * 1000);
  const overdue = pending.some((r) => r.createdAt < cutoff);
  const total = pending.reduce((s, r) => s + r.monto, 0);
  return {
    type: "pagos_administrativos",
    icon: "🧾",
    label: "Pagos administrativos pendientes de pago",
    meta: `${pending.length} solicitud${pending.length === 1 ? "" : "es"} · $${total.toFixed(2)}${overdue ? " · atrasado" : ""}`,
    overdue,
    href,
  };
}

// Cálculo compartido. Confirmado 2026-08-17 (corregido tras feedback del
// usuario): para quien paga, una solicitud esperando en Bandeja de
// aprobación YA es "un pago de mercadería pendiente" — aprobar y pagar casi
// siempre quedan en el mismo paso (ver PurchaseApprovalInbox.tsx), así que
// mostrar solo lo APPROVED-sin-pagar se quedaba corto y decía "no hay" con
// solicitudes reales esperando. Suma ambos estados: PENDING_APPROVAL (sin
// revisar todavía) y APPROVED (revisado, falta subir comprobante). El link
// va a Bandeja de aprobación si algo sigue sin revisar (ahí se decide y,
// casi siempre, se paga); si ya no queda nada por revisar y solo falta
// comprobante de algo ya aprobado, va directo a Finanzas.
async function getPurchaseMerchandisePaymentsSummary(comDeptId: string | null): Promise<{
  count: number;
  total: number;
  overdue: boolean;
  href: string;
}> {
  const base = comDeptId ? `/admin/dept/${comDeptId}` : "/admin";
  const cutoff = new Date(Date.now() - 24 * 60 * 60 * 1000);

  const groupRows = (rows: { groupId: string; totalCost: number; at: Date | null }[]) => {
    const byGroup = new Map<string, { total: number; at: Date | null }>();
    for (const r of rows) {
      const cur = byGroup.get(r.groupId) ?? { total: 0, at: r.at };
      cur.total += r.totalCost;
      byGroup.set(r.groupId, cur);
    }
    return [...byGroup.values()];
  };

  const [pendingApprovalRows, approvedRows] = await Promise.all([
    prisma.purchaseRequest.findMany({
      where: { status: "PENDING_APPROVAL" },
      select: { groupId: true, totalCost: true, requestedAt: true },
    }),
    prisma.purchaseRequest.findMany({
      where: { status: "APPROVED" },
      select: { groupId: true, totalCost: true, reviewedAt: true },
    }),
  ]);

  const pendingGroups = groupRows(pendingApprovalRows.map((r) => ({ groupId: r.groupId, totalCost: r.totalCost, at: r.requestedAt })));
  const approvedGroups = groupRows(approvedRows.map((r) => ({ groupId: r.groupId, totalCost: r.totalCost, at: r.reviewedAt })));
  const allGroups = [...pendingGroups, ...approvedGroups];

  const overdue = allGroups.some((g) => g.at && g.at < cutoff);
  const total = allGroups.reduce((s, g) => s + g.total, 0);
  const ptab = pendingGroups.length > 0 ? "aprobacion" : "finanzas";

  return { count: allGroups.length, total, overdue, href: `${base}?tab=compras&ptab=${ptab}` };
}

// Confirmado 2026-08-13: pedido explícito del usuario — un solo enlace en
// Inicio con el TOTAL de pagos de mercadería pendientes (ver criterio
// arriba). Mismo umbral de 24h que el resto de "atrasado" de este archivo.
async function getPurchaseMerchandisePendingItem(comDeptId: string | null): Promise<PendingItem | null> {
  const { count, total, overdue, href } = await getPurchaseMerchandisePaymentsSummary(comDeptId);
  if (count === 0) return null;
  return {
    type: "pagos_mercaderia",
    icon: "📦",
    label: "Pagos de mercadería pendientes",
    meta: `${count} operaci${count === 1 ? "ón" : "ones"} · $${total.toFixed(2)}${overdue ? " · atrasado" : ""}`,
    overdue,
    href,
  };
}

// Confirmado 2026-08-17: pedido explícito del usuario — acceso directo en
// Inicio para ir a pagar mercadería con un solo clic, pero SOLO cuando
// realmente hay algo pendiente (mismo criterio que
// getPurchaseMerchandisePendingItem). Antes se mostraba siempre, incluso
// con conteo 0 ("No hay pagos de mercadería pendientes"), pero el usuario
// pidió revertir eso el mismo día — prefiere que la tarjeta desaparezca
// cuando no hay nada que pagar.
export async function getPurchaseMerchandisePaymentsShortcut(): Promise<{
  count: number;
  total: number;
  overdue: boolean;
  href: string;
} | null> {
  const comDept = await prisma.department.findUnique({ where: { code: "COM" }, select: { id: true } });
  const summary = await getPurchaseMerchandisePaymentsSummary(comDept?.id ?? null);
  return summary.count === 0 ? null : summary;
}

// Confirmado 2026-08-13: mismo criterio que arriba, pero para fletes que
// quedaron pendientes de pago hasta la entrega (ON_DELIVERY) — mismo
// filtro exacto que ya usa PurchaseInvoicingPanel.tsx para su sección
// "Fletes pendientes".
async function getPurchaseShippingPendingItem(href: string): Promise<PendingItem | null> {
  const rows = await prisma.purchaseRequest.findMany({
    where: { shippingIncluded: false, shippingPaymentTiming: "ON_DELIVERY", shippingPaymentRequestedAt: { not: null }, shippingPaidAt: null },
    select: { groupId: true, shippingCostTotal: true, shippingPaymentRequestedAt: true },
  });
  if (rows.length === 0) return null;

  const byGroup = new Map<string, { total: number; requestedAt: Date | null }>();
  for (const r of rows) {
    const cur = byGroup.get(r.groupId) ?? { total: 0, requestedAt: r.shippingPaymentRequestedAt };
    cur.total += r.shippingCostTotal ?? 0;
    byGroup.set(r.groupId, cur);
  }
  const groups = [...byGroup.values()];
  const cutoff = new Date(Date.now() - 24 * 60 * 60 * 1000);
  const overdue = groups.some((g) => g.requestedAt && g.requestedAt < cutoff);
  const total = groups.reduce((s, g) => s + g.total, 0);
  return {
    type: "pagos_flete",
    icon: "🚚",
    label: "Fletes pendientes de pago",
    meta: `${groups.length} operación${groups.length === 1 ? "" : "es"} · $${total.toFixed(2)}${overdue ? " · atrasado" : ""}`,
    overdue,
    href,
  };
}

// Confirmado 2026-08-17: pedido explícito del usuario — Bryan (o cualquier
// otro delegado de Control de Compras, hoy o en el futuro) quiere ver en
// Inicio, con un solo clic, sus PROPIAS solicitudes de compra que quedaron
// esperando algo de él: rechazada (falta corregir y reenviar), falta subir
// la orden de compra, falta completar transportista/costo de envío, o
// admin/Finanzas le pidió cambiar la cuenta bancaria del proveedor. Filtra
// por requestedById (el DATO de quién la creó, no un permiso) — así aparece
// solo para quien de verdad tiene algo propio pendiente, sin importar su
// departamento real (mismo espíritu que el resto de "Control de Compras",
// que ya vive fuera de dept.code — ver canSubmitPurchaseRequests).
async function getPurchaseRequesterPendingItems(userId: string, href: string): Promise<PendingItem[]> {
  const rows = await prisma.purchaseRequest.findMany({
    where: { requestedById: userId },
    select: { groupId: true, status: true, purchaseOrderUrl: true, shippingCarrierPending: true, bankAccountChangeRequestedAt: true, requestedAt: true },
  });
  if (rows.length === 0) return [];

  const byGroup = new Map<string, (typeof rows)[number]>();
  for (const r of rows) if (!byGroup.has(r.groupId)) byGroup.set(r.groupId, r);
  const groups = [...byGroup.values()];
  const cutoff = new Date(Date.now() - 24 * 60 * 60 * 1000);
  const items: PendingItem[] = [];

  const rejected = groups.filter((g) => g.status === "REJECTED");
  if (rejected.length > 0) {
    items.push({
      type: "compras_rechazadas",
      icon: "🔁",
      label: "Solicitudes de compra rechazadas — corregir y reenviar",
      meta: `${rejected.length} solicitud${rejected.length === 1 ? "" : "es"} · atrasado`,
      overdue: true,
      href,
    });
  }

  const missingPO = groups.filter((g) => g.status !== "REJECTED" && !g.purchaseOrderUrl);
  if (missingPO.length > 0) {
    const overdue = missingPO.some((g) => g.requestedAt < cutoff);
    items.push({
      type: "compras_orden_compra",
      icon: "📄",
      label: "Falta subir la orden de compra",
      meta: `${missingPO.length} solicitud${missingPO.length === 1 ? "" : "es"}${overdue ? " · atrasado" : ""}`,
      overdue,
      href,
    });
  }

  const missingCarrier = groups.filter((g) => g.status !== "REJECTED" && g.shippingCarrierPending);
  if (missingCarrier.length > 0) {
    const overdue = missingCarrier.some((g) => g.requestedAt < cutoff);
    items.push({
      type: "compras_transportista",
      icon: "🚚",
      label: "Falta completar transportista y costo de envío",
      meta: `${missingCarrier.length} solicitud${missingCarrier.length === 1 ? "" : "es"}${overdue ? " · atrasado" : ""}`,
      overdue,
      href,
    });
  }

  const bankChange = groups.filter((g) => g.status !== "REJECTED" && g.bankAccountChangeRequestedAt);
  if (bankChange.length > 0) {
    items.push({
      type: "compras_cuenta_bancaria",
      icon: "🏦",
      label: "Cambia la cuenta bancaria del proveedor — la anterior no sirvió",
      meta: `${bankChange.length} solicitud${bankChange.length === 1 ? "" : "es"} · atrasado`,
      overdue: true,
      href,
    });
  }

  return items;
}

// Confirmado 2026-08-26, pedido explícito del usuario: quien resuelve un
// producto de "Cambio con proveedor" (Registro de Egresos) ya no es Daniel —
// es quien solicitó ORIGINALMENTE la compra de ese producto a ese proveedor
// (requestedById), o Bryan si el producto no tenía compra vinculada. Filtra
// por dato de dueño (mismo espíritu que getPurchaseRequesterPendingItems),
// no por permiso de departamento — por eso vive en /area/cambio-proveedor-gestiones,
// no dentro del módulo de Egresos.
// Extraído a función propia (confirmado 2026-08-27) — además de alimentar la
// tarjeta de Inicio (solo líderes, ver getPendingTasksForActor), el sidebar
// (EmployeeSidebar/AreaLayout) necesita el mismo conteo para CUALQUIER
// empleado, no solo líderes, porque /api/merchandise-outflow/supplier-exchange/mine
// (el dueño real de este flujo) tampoco exige liderazgo.
export async function getSupplierExchangeGestorCount(userId: string): Promise<number> {
  const marketingLeadId = await getMarketingLeadId();
  const or: Record<string, unknown>[] = [{ linkedPurchaseRequest: { requestedById: userId } }];
  if (marketingLeadId === userId) or.push({ linkedPurchaseRequestId: null });

  return prisma.merchandiseOutflowItem.count({
    where: { batch: { reason: "CAMBIO_PROVEEDOR", submittedAt: { not: null } }, resolution: null, OR: or },
  });
}

async function getSupplierExchangeGestorPendingItem(userId: string, href: string): Promise<PendingItem | null> {
  const count = await getSupplierExchangeGestorCount(userId);
  if (count === 0) return null;
  return {
    type: "cambio_proveedor_gestion",
    icon: "🔁",
    label: "Cambio con proveedor pendiente de tu gestión",
    meta: `${count} producto${count === 1 ? "" : "s"}`,
    overdue: false,
    href,
  };
}

// Confirmado 2026-08-17: pedido explícito del usuario — Daniel (líder de
// Inventario) ve en Inicio, con un solo clic, las solicitudes de compra ya
// pagadas (PAID) que le faltan confirmar como recibidas en Control de
// Compras → pestaña Inventario. Mismo umbral de 24h sobre paidAt que ya usa
// getStalePurchaseRequestPushes (paidUnreceived) para "atrasado", y mismo
// agrupado por groupId que getPurchaseMerchandisePaymentsSummary — una
// cotización con varias líneas cuenta como una sola operación pendiente.
// Fix confirmado 2026-08-24 (reportado por Daniel): esto solo miraba status
// "PAID" (nadie del equipo subió todavía fotos/video de recepción). En
// cuanto alguien del equipo las sube, el status pasa a
// RECEIVED_PENDING_REVIEW (ver PurchaseRequestReceipt.approvedAt, null en
// ese estado) esperando la aprobación final de Daniel — pero como ese status
// no estaba incluido acá, el pendiente desaparecía de Inicio justo cuando a
// Daniel le tocaba actuar ("Aprobar recepción"), aunque siguiera pendiente
// de verdad. Ahora cuenta ambos estados; el timestamp para "atrasado" usa
// receipt.confirmedAt (cuándo se subió la recepción) si ya existe, si no
// paidAt.
async function getPurchaseReceivingPendingItem(href: string): Promise<PendingItem | null> {
  const rows = await prisma.purchaseRequest.findMany({
    where: { status: { in: ["PAID", "RECEIVED_PENDING_REVIEW"] } },
    select: { groupId: true, totalCost: true, paidAt: true, receipt: { select: { confirmedAt: true } } },
  });
  if (rows.length === 0) return null;

  const byGroup = new Map<string, { total: number; at: Date | null }>();
  for (const r of rows) {
    const at = r.receipt?.confirmedAt ?? r.paidAt;
    const cur = byGroup.get(r.groupId) ?? { total: 0, at };
    cur.total += r.totalCost;
    byGroup.set(r.groupId, cur);
  }
  const groups = [...byGroup.values()];
  const cutoff = new Date(Date.now() - 24 * 60 * 60 * 1000);
  const overdue = groups.some((g) => g.at && g.at < cutoff);
  const total = groups.reduce((s, g) => s + g.total, 0);
  return {
    type: "compras_recepcion",
    icon: "📥",
    label: "Confirmar mercadería recibida",
    meta: `${groups.length} solicitud${groups.length === 1 ? "" : "es"} · $${total.toFixed(2)}${overdue ? " · atrasado" : ""}`,
    overdue,
    href,
  };
}

// Confirmado 2026-08-17: pedido explícito del usuario — los cambios de
// mercadería (PurchaseUrgentResolution tipo REPLACEMENT) que quien coordina
// con el proveedor dejó en curso y siguen PENDING de que Daniel verifique
// que llegaron bien (misma pantalla, misma metodología de fotos + IA que una
// recepción normal — ver api/purchase-requests/urgent-resolutions/[id]/
// replacement-arrived). "Atrasado" solo una vez pasada la fecha máxima que
// se puso al coordinar el cambio (replacementDueDate) — antes de esa fecha
// el cambio sigue en camino y no hay nada que Daniel pueda hacer todavía,
// pero igual se muestra para que lo tenga en el radar.
async function getPurchaseReplacementVerificationPendingItem(href: string): Promise<PendingItem | null> {
  const rows = await prisma.purchaseUrgentResolution.findMany({
    where: { type: "REPLACEMENT", status: "PENDING" },
    select: { replacementDueDate: true },
  });
  if (rows.length === 0) return null;

  const now = new Date();
  const overdue = rows.some((r) => r.replacementDueDate != null && r.replacementDueDate < now);
  return {
    type: "compras_cambios_verificar",
    icon: "🔄",
    label: "Verificar cambios de mercadería",
    meta: `${rows.length} cambio${rows.length === 1 ? "" : "s"} pendiente${rows.length === 1 ? "" : "s"}${overdue ? " · atrasado" : ""}`,
    overdue,
    href,
  };
}

// Confirmado 2026-08-25: "Reclamo posterior al cierre" — daño descubierto
// DÍAS después de confirmar recibido. Dos colas propias de Daniel, mismo
// patrón que getPurchaseReceivingPendingItem: reclamos que su equipo subió
// y todavía no revisó, y reclamos ya aprobados esperando que él confirme la
// baja en Just.
async function getLateClaimReviewPendingItem(href: string): Promise<PendingItem | null> {
  const rows = await prisma.purchaseRequestUrgentReport.findMany({
    where: { isLateClaim: true, reviewedByLeadAt: null, rejectedAt: null },
    select: { reportedAt: true },
  });
  if (rows.length === 0) return null;
  const cutoff = new Date(Date.now() - 24 * 60 * 60 * 1000);
  const overdue = rows.some((r) => r.reportedAt < cutoff);
  return {
    type: "compras_reclamo_posterior_revision",
    icon: "📦",
    label: "Reclamos posteriores al cierre por revisar",
    meta: `${rows.length} reclamo${rows.length === 1 ? "" : "s"}${overdue ? " · atrasado" : ""}`,
    overdue,
    href,
  };
}

async function getLateClaimJustPendingItem(href: string): Promise<PendingItem | null> {
  const rows = await prisma.purchaseRequestUrgentReport.findMany({
    where: { isLateClaim: true, reviewedByLeadAt: { not: null }, rejectedAt: null, justConfirmedAt: null },
    select: { reviewedByLeadAt: true },
  });
  if (rows.length === 0) return null;
  const cutoff = new Date(Date.now() - 24 * 60 * 60 * 1000);
  const overdue = rows.some((r) => r.reviewedByLeadAt && r.reviewedByLeadAt < cutoff);
  return {
    type: "compras_reclamo_posterior_just",
    icon: "📦",
    label: "Reclamos posteriores al cierre por dar de baja en Just",
    meta: `${rows.length} reclamo${rows.length === 1 ? "" : "s"}${overdue ? " · atrasado" : ""}`,
    overdue,
    href,
  };
}

// Confirmado 2026-08-17: pedido explícito del usuario — un enlace de un
// clic en Inicio para que Bryan (o quien coordina con el proveedor) le dé
// seguimiento a los créditos ya acordados (tipo CREDIT, resueltos en
// Reportes urgentes) que siguen sin usarse en una compra futura. Mismo
// cálculo que la sección "Créditos pendientes de recuperar" de
// PurchaseUrgentReportsPanel.tsx (créditos con SupplierCredit.status
// AVAILABLE), pero acá "atrasado" usa el mismo umbral de 24h que el resto de
// este archivo en vez del "30 días" que ese panel usa solo para resaltar en
// rojo visualmente.
async function getPurchaseCreditsPendingItem(href: string): Promise<PendingItem | null> {
  const rows = await prisma.purchaseUrgentResolution.findMany({
    where: { type: "CREDIT", credit: { status: "AVAILABLE" } },
    select: { amount: true, createdAt: true },
  });
  if (rows.length === 0) return null;

  const cutoff = new Date(Date.now() - 24 * 60 * 60 * 1000);
  const overdue = rows.some((r) => r.createdAt < cutoff);
  const total = rows.reduce((s, r) => s + r.amount, 0);
  return {
    type: "compras_creditos_pendientes",
    icon: "🪙",
    label: "Créditos pendientes de recuperar",
    meta: `${rows.length} crédito${rows.length === 1 ? "" : "s"} · $${total.toFixed(2)}${overdue ? " · atrasado" : ""}`,
    overdue,
    href,
  };
}

// Confirmado 2026-08-17: pedido explícito del usuario (día 3, mismo plazo
// que Roles de pago) — la captura mensual de Control de Inventario que
// Daniel hace a mano no tenía ningún aviso en Inicio, había que entrar a
// ojear el tab para notar que faltaba. El valor vive en
// FinanceSharedMonthlyBalance bajo el departamento Finanzas, no Inventario
// (mismo detalle ya documentado en getFinanzasDeptId/inventoryKpis.ts) —
// company-wide, no por departamento.
async function getInventoryControlPendingItem(href: string): Promise<PendingItem | null> {
  const today = currentMonthStr();
  const prev = prevMonthStr(today);
  if (!fixedDayDeadlinePassed(today, 3)) return null;

  const finDeptId = await getFinanzasDeptId();
  if (!finDeptId) return null;
  const rec = await prisma.financeSharedMonthlyBalance.findUnique({
    where: { deptId_period: { deptId: finDeptId, period: prev } },
    select: { inventarioFinal: true },
  });
  if (rec?.inventarioFinal != null) return null;

  return {
    type: "control_inventario",
    icon: "📋",
    label: "Control de Inventario — captura mensual",
    meta: `${formatMonthLabel(prev)} · atrasado`,
    overdue: true,
    href,
  };
}

// Confirmado 2026-08-25: pedido explícito de Daniel — le avise cuando ya
// pasó la fecha límite de una semana (ver snapshotPeriodDeadline en
// inventoryKpis.ts: último día laborable del bloque, antes de las 12 si cae
// sábado, antes de las 4pm cualquier otro día) y todavía no subió el Excel
// de stock por SKU de esa semana. Igual espíritu que
// getMerchandiseWeeklyWriteOffJustPendingItem: junta TODAS las semanas
// atrasadas sin cargar (no solo la más reciente), no solo "ya te avisé una
// vez, no insisto más".
async function getInventoryWeeklySnapshotPendingItem(href: string): Promise<PendingItem | null> {
  const deptId = await getFinanzasDeptId();
  if (!deptId) return null;

  const overduePeriods = recentInventorySnapshotPeriods().filter((p) => isSnapshotPeriodOverdue(p));
  if (overduePeriods.length === 0) return null;

  const loaded = await prisma.inventoryProductSnapshot.findMany({
    where: { deptId, period: { in: overduePeriods } },
    select: { period: true },
    distinct: ["period"],
  });
  const loadedSet = new Set(loaded.map((r) => r.period));
  const missing = overduePeriods.filter((p) => !loadedSet.has(p)).sort();
  if (missing.length === 0) return null;

  return {
    type: "control_inventario_semanal",
    icon: "📊",
    label: "Control de Inventario — Excel semanal de stock por SKU",
    meta: `${missing.length === 1 ? snapshotPeriodLabel(missing[0]) : `${missing.length} semanas`} · atrasado`,
    overdue: true,
    href,
  };
}

// Confirmado 2026-08-14: pedido explícito del usuario — quiere ver en
// Inicio, con un solo clic, todas las horas extra que le quedaron por
// aprobar (exclusivo admin — canApproveOvertimeHours es admin-only). Ahora
// que la carga se cierra el mismo día trabajado, cualquier hora que siga
// sin aprobar al día siguiente ya cuenta como atrasada — si no se aprueba,
// "Generar roles de esta quincena" no la va a incluir.
async function getOvertimeApprovalPendingItem(href: string): Promise<PendingItem | null> {
  const rows = await prisma.overtimeEntry.findMany({
    where: { approvedAt: null, rejectedAt: null },
    select: { date: true, minutesExtra: true },
  });
  if (rows.length === 0) return null;

  const cutoff = new Date(); cutoff.setUTCHours(0, 0, 0, 0);
  const overdue = rows.some((r) => r.date < cutoff);
  const totalMinutes = rows.reduce((s, r) => s + r.minutesExtra, 0);
  const hours = (totalMinutes / 60).toFixed(1).replace(/\.0$/, "");
  return {
    type: "horas_extra_aprobacion",
    icon: "⏱️",
    label: "Horas extra por aprobar",
    meta: `${rows.length} entrada${rows.length === 1 ? "" : "s"} · ${hours}h${overdue ? " · atrasado" : ""}`,
    overdue,
    href,
  };
}

// Confirmado 2026-08-18: pedido explícito del usuario — mismo patrón que
// getOvertimeApprovalPendingItem, un acceso directo en Inicio para las
// propuestas de comisión de equipo (CommissionTierAmount.pendingAmount) y
// de bono fijo mensual (FixedMonthlyBonus.pendingAmount) que siguen sin
// aprobar. Exclusivo del admin — canApproveCommissionAmounts y
// canApproveFixedMonthlyBonus son admin-only, sin auto-aprobación. Cuando
// hay de los dos tipos a la vez, el link entra directo a la sub-pestaña de
// comisiones primero (PayrollWorkspace lee "ptab" — ver useEffect agregado
// ahí), la persona resuelve esa y vuelve a Inicio para la de bono fijo.
async function getCommissionAndBonusApprovalPendingItem(hrefBase: string): Promise<PendingItem | null> {
  const [commissionRows, bonusRows] = await Promise.all([
    prisma.commissionTierAmount.findMany({ where: { pendingAmount: { not: null } }, select: { proposedAt: true } }),
    prisma.fixedMonthlyBonus.findMany({ where: { pendingAmount: { not: null } }, select: { proposedAt: true } }),
  ]);
  const total = commissionRows.length + bonusRows.length;
  if (total === 0) return null;

  const cutoff = new Date(Date.now() - 24 * 60 * 60 * 1000);
  const overdue = [...commissionRows, ...bonusRows].some((r) => r.proposedAt != null && r.proposedAt < cutoff);
  const ptab = commissionRows.length > 0 ? "comisiones" : "roles";
  return {
    type: "comisiones_bonos_aprobacion",
    icon: "💵",
    label: "Comisiones y bonos por aprobar",
    meta: `${total} propuesta${total === 1 ? "" : "s"}${overdue ? " · atrasado" : ""}`,
    overdue,
    href: `${hrefBase}?tab=pagos&ptab=${ptab}`,
  };
}

// Confirmado 2026-08-18: mismo patrón que getCommissionAndBonusApprovalPendingItem
// — anticipos que siguen esperando la aprobación del admin (y el
// comprobante de transferencia).
async function getSalaryAdvancePendingItem(href: string): Promise<PendingItem | null> {
  const rows = await prisma.salaryAdvance.findMany({ where: { status: "PENDING" }, select: { amount: true, createdAt: true } });
  if (rows.length === 0) return null;

  const cutoff = new Date(Date.now() - 24 * 60 * 60 * 1000);
  const overdue = rows.some((r) => r.createdAt < cutoff);
  const total = rows.reduce((s, r) => s + r.amount, 0);
  return {
    type: "anticipos_aprobacion",
    icon: "💵",
    label: "Anticipos por aprobar",
    meta: `${rows.length} solicitud${rows.length === 1 ? "" : "es"} · $${total.toFixed(2)}${overdue ? " · atrasado" : ""}`,
    overdue,
    href,
  };
}

function payrollDestinationLabel(destination: "NAIROBY" | "ADMIN_PRODUBANCO" | "ADMIN_COMPANY"): string {
  if (destination === "NAIROBY") return "cuenta de Nairoby";
  if (destination === "ADMIN_PRODUBANCO") return "tu cuenta Produbanco";
  return "tu cuenta para recibir transferencias";
}

// Confirmado 2026-08-23: pedido explícito del usuario — 3 días hábiles
// antes de la fecha de pago de cada quincena (ver payDateForPeriod), tanto
// el admin como Nairoby ven en Inicio la transferencia real pendiente (el
// total de la quincena + a qué cuenta corresponde). El admin ve una versión
// accionable (falta aprobar/transferir, o corrigió algo tras un rechazo);
// Nairoby la ve de solo lectura, salvo cuando el admin la rechazó — ahí es
// ella quien tiene que corregir el rol señalado. Desaparece sola en cuanto
// el admin sube el comprobante (status COMPLETED). Compartido entre nómina
// e IESS (agregado 2026-08-27 tras notar que el de IESS nunca se había
// conectado a Inicio — Nairoby lo enviaba y el admin no se enteraba).
async function getPayrollTransferKindPendingItem(opts: {
  forAdmin: boolean;
  href: string;
  noun: string;
  type: string;
  rows: { status: string; totalAmount: number; destination: "NAIROBY" | "ADMIN_PRODUBANCO" | "ADMIN_COMPANY"; period: { period: string } }[];
}): Promise<PendingItem | null> {
  const { forAdmin, href, noun, type, rows } = opts;
  const now = nowInEcuador();

  for (const t of rows) {
    const payDate = payDateForPeriod(t.period.period);
    if (now < businessDaysBefore(payDate, 3)) continue;

    const overdue = forAdmin ? now >= payDate : t.status === "REJECTED";
    const acctLabel = payrollDestinationLabel(t.destination);
    const quincenaLabel = `${isEndOfMonthQuincena(t.period.period) ? "Fin de mes" : "Quincena"} · ${formatMonthLabel(monthOfPeriod(t.period.period))}`;

    const label = forAdmin
      ? t.status === "REJECTED"
        ? `Rechazaste la transferencia de ${noun} — falta que Nairoby corrija`
        : `Transferir ${noun} a ${acctLabel}`
      : t.status === "REJECTED"
        ? `El admin rechazó la transferencia de ${noun} — corregí el rol señalado`
        : `Transferencia de ${noun} — esperando aprobación del admin`;

    return {
      type,
      icon: "💸",
      label,
      meta: `${quincenaLabel} · $${t.totalAmount.toFixed(2)}${overdue ? " · atrasado" : ""}`,
      overdue,
      href,
    };
  }
  return null;
}

async function getPayrollTransferPendingItem(forAdmin: boolean, href: string): Promise<PendingItem | null> {
  const rows = await prisma.payrollTransfer.findMany({
    where: { status: { in: ["PENDING_APPROVAL", "REJECTED"] } },
    include: { period: { select: { period: true } } },
  });
  return getPayrollTransferKindPendingItem({ forAdmin, href, noun: "nómina", type: "nomina_transferencia", rows });
}

async function getPayrollIessTransferPendingItem(forAdmin: boolean, href: string): Promise<PendingItem | null> {
  const rows = await prisma.payrollIessTransfer.findMany({
    where: { status: { in: ["PENDING_APPROVAL", "REJECTED"] } },
    include: { period: { select: { period: true } } },
  });
  return getPayrollTransferKindPendingItem({ forAdmin, href, noun: "IESS", type: "iess_transferencia", rows });
}

// Confirmado 2026-08-18: pedido explícito del usuario — si un descuento por
// mala gestión sigue sin ser aceptado por el colaborador afectado, tanto
// Andrés (admin) como Nairoby (FIN) tienen que verlo en sus Pendientes, para
// saber que esa gestión todavía no fue aceptada.
async function getManagementDeductionUnacceptedPendingItem(href: string): Promise<PendingItem | null> {
  const rows = await prisma.managementDeduction.findMany({
    where: { acceptedAt: null },
    select: { totalAmount: true, createdAt: true, employee: { select: { name: true } } },
  });
  if (rows.length === 0) return null;

  const cutoff = new Date(Date.now() - 24 * 60 * 60 * 1000);
  const overdue = rows.some((r) => r.createdAt < cutoff);
  const names = rows.map((r) => r.employee.name).join(", ");
  return {
    type: "descuentos_sin_aceptar",
    icon: "⚠️",
    label: "Descuentos por mala gestión sin aceptar",
    meta: `${rows.length === 1 ? names : `${rows.length} colaboradores`}${overdue ? " · atrasado" : ""}`,
    overdue,
    href,
  };
}

// Confirmado 2026-08-20: pedido explícito del usuario — cuando le crean un
// descuento por mala gestión, el colaborador AFECTADO (no solo admin/líder
// de FIN, que ya lo ven vía getManagementDeductionUnacceptedPendingItem)
// tiene que verlo en su propio Inicio para aceptarlo con un solo clic, en
// vez de enterarse solo por el push y tener que entrar a ciegas a Roles de
// pago. A diferencia del resto de este archivo, este chequeo aplica a
// CUALQUIER colaborador (líder o no, de cualquier departamento) — se
// resuelve por dato propio (employeeId), no por permiso/rol.
async function getMyManagementDeductionPendingItem(userId: string, href: string): Promise<PendingItem | null> {
  const rows = await prisma.managementDeduction.findMany({
    where: { employeeId: userId, acceptedAt: null },
    select: { totalAmount: true, createdAt: true },
  });
  if (rows.length === 0) return null;

  const cutoff = new Date(Date.now() - 24 * 60 * 60 * 1000);
  const overdue = rows.some((r) => r.createdAt < cutoff);
  const total = rows.reduce((s, r) => s + r.totalAmount, 0);
  return {
    type: "mis_descuentos_pendientes",
    icon: "⚠️",
    label: rows.length === 1 ? "Tienes un descuento por confirmar" : `Tienes ${rows.length} descuentos por confirmar`,
    meta: `$${total.toFixed(2)}${overdue ? " · atrasado" : ""}`,
    overdue,
    href,
  };
}

// Confirmado 2026-08-23: pedido explícito del usuario — cualquier
// colaborador que todavía no matriculó su cuenta bancaria (ver
// MyBankAccountPanel, /area/roles-de-pago) lo ve como pendiente en Inicio,
// con una descripción breve de para qué sirve, hasta que la registre. Mismo
// patrón "por dato propio" que getMyManagementDeductionPendingItem — aplica
// a cualquiera, líder o no, de cualquier departamento. Admin queda afuera a
// propósito: /api/employee-bank-account nunca deja registrar cuenta al rol
// admin, no cobra por este sistema.
async function getMyBankAccountPendingItem(userId: string, href: string): Promise<PendingItem | null> {
  const hasAccount = (await prisma.employeeBankAccount.count({ where: { employeeId: userId } })) > 0;
  if (hasAccount) return null;
  return {
    type: "mi_cuenta_bancaria",
    icon: "🏦",
    label: "Registra tu cuenta bancaria",
    meta: "Es a donde Nairoby te transfiere el sueldo, anticipos y bonos — sin ella no te puede pagar.",
    overdue: true,
    href,
  };
}

// Confirmado 2026-08-19: pedido explícito del usuario — acceso directo
// para Daniel cuando hay lotes de Reingreso de Mercadería ya enviados por
// el equipo y esperando su revisión (submittedAt no nulo, danielApprovedAt
// nulo). El link entra directo a la pestaña "Revisión".
async function getMerchandiseReentryPendingItem(href: string): Promise<PendingItem | null> {
  const rows = await prisma.merchandiseReentryBatch.findMany({
    where: { submittedAt: { not: null }, danielApprovedAt: null },
    select: { code: true, submittedAt: true },
  });
  if (rows.length === 0) return null;

  const cutoff = new Date(Date.now() - 24 * 60 * 60 * 1000);
  const overdue = rows.some((r) => (r.submittedAt ?? new Date()) < cutoff);
  return {
    type: "reingreso_mercaderia_revision",
    icon: "📦",
    label: "Reingreso de mercadería por revisar",
    meta: `${rows.length === 1 ? rows[0].code : `${rows.length} lotes`}${overdue ? " · atrasado" : ""}`,
    overdue,
    href,
  };
}

// Confirmado 2026-08-21: pedido explícito del usuario — acceso directo para
// Daniel cuando ya pasó el corte del sábado de una semana y todavía le
// falta dar de baja en Just el acumulado de productos "no solucionados"
// (ver damageSolved en MerchandiseReentryItem).
async function getMerchandiseWeeklyWriteOffJustPendingItem(href: string): Promise<PendingItem | null> {
  const rows = await prisma.merchandiseWeeklyWriteOffBatch.findMany({
    where: { justWrittenOffAt: null, weekEnd: { lt: new Date() } },
    select: { weekStart: true },
  });
  if (rows.length === 0) return null;
  return {
    type: "reingreso_mercaderia_baja_just",
    icon: "🗑️",
    label: "Semana de productos dañados por dar de baja en Just",
    meta: `${rows.length === 1 ? "1 semana" : `${rows.length} semanas`} · atrasado`,
    overdue: true,
    href,
  };
}

// Confirmado 2026-08-21: pedido explícito del usuario — acceso directo con
// un solo clic para Nairoby cuando Daniel ya dio de baja en Just un lote
// semanal y le falta a ella la verificación física + doble confirmación.
async function getMerchandiseWeeklyWriteOffVerificationPendingItem(href: string): Promise<PendingItem | null> {
  const rows = await prisma.merchandiseWeeklyWriteOffBatch.findMany({
    where: { justWrittenOffAt: { not: null }, nairobyConfirmedAt: null },
    select: { justWrittenOffAt: true },
  });
  if (rows.length === 0) return null;
  const cutoff = new Date(Date.now() - 24 * 60 * 60 * 1000);
  const overdue = rows.some((r) => (r.justWrittenOffAt ?? new Date()) < cutoff);
  return {
    type: "reingreso_mercaderia_verificacion_semanal",
    icon: "🔎",
    label: "Lote semanal de productos dañados por verificar",
    meta: `${rows.length === 1 ? "1 lote" : `${rows.length} lotes`}${overdue ? " · atrasado" : ""}`,
    overdue,
    href,
  };
}

// Confirmado 2026-08-19: pedido explícito del usuario — acceso directo en
// Inicio para Daniel (líder de Inventario) a los pedidos de compra personal
// recién enviados que todavía le faltan confirmar producto/cantidad — antes
// tenía que entrar a la pantalla a ciegas para notar que había algo nuevo.
// Mismo umbral de 24h que el resto de "atrasado" de este archivo.
async function getPersonalPurchasePendingInventoryItem(href: string): Promise<PendingItem | null> {
  const rows = await prisma.personalPurchaseOrder.findMany({
    where: { status: "PENDING_INVENTORY" },
    select: { createdAt: true, employee: { select: { name: true } } },
  });
  if (rows.length === 0) return null;

  const cutoff = new Date(Date.now() - 24 * 60 * 60 * 1000);
  const overdue = rows.some((r) => r.createdAt < cutoff);
  const names = rows.map((r) => r.employee.name).join(", ");
  return {
    type: "compras_personales_confirmar",
    icon: "🛒",
    label: "Compras personales — falta confirmar producto/cantidad",
    meta: `${rows.length === 1 ? names : `${rows.length} pedidos`}${overdue ? " · atrasado" : ""}`,
    overdue,
    href,
  };
}

// Confirmado 2026-08-18: pedido explícito del usuario — una vez que Daniel
// confirma un pedido de compra personal, la información completa le tiene
// que llegar a Nairoby (o admin) como un pendiente de ACCIÓN (ella decide
// precio y cuotas) — a diferencia del aviso a Andrés, que es puramente
// informativo y va a la campanita, no acá.
async function getPersonalPurchasePendingFinanceItem(href: string): Promise<PendingItem | null> {
  const rows = await prisma.personalPurchaseOrder.findMany({
    where: { status: "PENDING_FINANCE" },
    select: { inventoryConfirmedAt: true, employee: { select: { name: true } } },
  });
  if (rows.length === 0) return null;

  const cutoff = new Date(Date.now() - 24 * 60 * 60 * 1000);
  const overdue = rows.some((r) => (r.inventoryConfirmedAt ?? new Date()) < cutoff);
  const names = rows.map((r) => r.employee.name).join(", ");
  return {
    type: "compras_personales_precio",
    icon: "🛒",
    label: "Compras personales — falta cerrar el precio",
    meta: `${rows.length === 1 ? names : `${rows.length} pedidos`}${overdue ? " · atrasado" : ""}`,
    overdue,
    href,
  };
}

// Confirmado 2026-08-20: comprobante de transferencia pegado por el
// colaborador — exclusivo del admin, solo él puede chequear su cuenta
// bancaria real antes de confirmar.
async function getPersonalPurchaseTransferConfirmPendingItem(href: string): Promise<PendingItem | null> {
  const rows = await prisma.personalPurchaseOrder.findMany({
    where: { status: "PENDING_ADMIN_CONFIRM" },
    select: { transferProofUploadedAt: true, employee: { select: { name: true } } },
  });
  if (rows.length === 0) return null;

  const cutoff = new Date(Date.now() - 24 * 60 * 60 * 1000);
  const overdue = rows.some((r) => (r.transferProofUploadedAt ?? new Date()) < cutoff);
  const names = rows.map((r) => r.employee.name).join(", ");
  return {
    type: "compras_personales_transferencia",
    icon: "🏦",
    label: "Compras personales — comprobante por confirmar",
    meta: `${rows.length === 1 ? names : `${rows.length} pedidos`}${overdue ? " · atrasado" : ""}`,
    overdue,
    href,
  };
}

// Confirmado 2026-08-20: el admin ya confirmó que la transferencia llegó —
// falta el cierre final de Nairoby/FIN (o admin) para completar la
// operación.
async function getPersonalPurchaseTransferClosePendingItem(href: string): Promise<PendingItem | null> {
  const rows = await prisma.personalPurchaseOrder.findMany({
    where: { status: "PENDING_NAIROBY_CLOSE" },
    select: { transferAdminConfirmedAt: true, employee: { select: { name: true } } },
  });
  if (rows.length === 0) return null;

  const cutoff = new Date(Date.now() - 24 * 60 * 60 * 1000);
  const overdue = rows.some((r) => (r.transferAdminConfirmedAt ?? new Date()) < cutoff);
  const names = rows.map((r) => r.employee.name).join(", ");
  return {
    type: "compras_personales_cierre",
    icon: "🏦",
    label: "Compras personales — transferencia confirmada, falta cerrar",
    meta: `${rows.length === 1 ? names : `${rows.length} pedidos`}${overdue ? " · atrasado" : ""}`,
    overdue,
    href,
  };
}

// Confirmado 2026-08-21: pedido explícito del usuario — una vez que Nairoby
// cierra el precio, el colaborador tiene que elegir cómo paga
// (PENDING_PAYMENT_METHOD) o, si eligió transferencia, subir el comprobante
// (PENDING_TRANSFER_PROOF) — pero ese pendiente no aparecía en su propio
// Inicio, así que solo se enteraba por el push diario (ver
// getStalePersonalPurchaseTransferPushes en personalPurchases.ts) o entrando
// a ciegas a Compras personales. Mismo agrupado de estados y mismo
// transferDeadlineAt (3 días hábiles desde que se cerró el precio) que ya
// usa ese push, para que "atrasado" acá coincida exactamente con el momento
// en que ese push dejaría de mandarse al colaborador. A diferencia del
// resto de este archivo, aplica a CUALQUIER colaborador (líder o no) — se
// resuelve por dato propio (employeeId), no por permiso/rol.
async function getMyPersonalPurchasePaymentPendingItem(employeeId: string, href: string): Promise<PendingItem | null> {
  const rows = await prisma.personalPurchaseOrder.findMany({
    where: { employeeId, status: { in: ["PENDING_PAYMENT_METHOD", "PENDING_TRANSFER_PROOF"] } },
    select: { status: true, totalAmount: true, transferDeadlineAt: true },
  });
  if (rows.length === 0) return null;

  const now = new Date();
  const overdue = rows.some((r) => r.transferDeadlineAt != null && r.transferDeadlineAt <= now);
  const total = rows.reduce((s, r) => s + (r.totalAmount ?? 0), 0);
  const meta =
    rows.length === 1
      ? `$${total.toFixed(2)} · ${rows[0].status === "PENDING_PAYMENT_METHOD" ? "falta elegir cómo pagar" : "falta subir comprobante"}${overdue ? " · atrasado" : ""}`
      : `${rows.length} pedidos · $${total.toFixed(2)}${overdue ? " · atrasado" : ""}`;
  return {
    type: "compras_personales_metodo_pago",
    icon: "💵",
    label: "Compras personales — pago pendiente",
    meta,
    overdue,
    href,
  };
}

// Confirmado 2026-08-21: pedido explícito del usuario — mientras la compra
// personal espera que OTROS actúen (bodega confirmando el producto, o
// Nairoby/FIN fijando el precio una vez que bodega ya confirmó), el
// colaborador no tenía forma de ver ese avance sin entrar a ciegas a Compras
// personales — el único aviso era el push puntual de "ya podés retirarlo",
// que se puede perder. A diferencia de getMyPersonalPurchasePaymentPendingItem
// (una acción PROPIA pendiente), esto es puramente informativo — nunca
// "atrasado", solo mantiene visible el estado actual en Inicio. Mismo texto
// de estado que ya usa STATUS_LABEL en PersonalPurchasesPanel.tsx. Aplica a
// cualquier colaborador, líder o no.
async function getMyPersonalPurchaseStatusPendingItem(employeeId: string, href: string): Promise<PendingItem | null> {
  const rows = await prisma.personalPurchaseOrder.findMany({
    where: { employeeId, status: { in: ["PENDING_INVENTORY", "PENDING_FINANCE"] } },
    select: { status: true },
  });
  if (rows.length === 0) return null;

  const statusLabel = (s: string) => (s === "PENDING_INVENTORY" ? "Esperando confirmación de bodega" : "Bodega confirmó — falta que Nairoby cierre el precio");
  const meta = rows.length === 1 ? statusLabel(rows[0].status) : `${rows.length} pedidos en curso`;
  return {
    type: "compras_personales_estado",
    icon: "🛒",
    label: "Compras personales — seguimiento",
    meta,
    overdue: false,
    href,
  };
}

// Confirmado 2026-08-21: pedido explícito del usuario — a diferencia del
// pendiente anterior (que es del colaborador, es su acción), esto es
// puramente de lectura para Nairoby/FIN y admin: quién sigue sin resolver el
// pago de su compra personal, para poder darle seguimiento oportuno en vez
// de enterarse recién cuando ya está atrasado (el único aviso que tenían
// antes era el push de "vencido", que solo dispara una vez pasado el plazo).
// Mismo agrupado de estados y mismo transferDeadlineAt que el pendiente del
// colaborador arriba.
async function getPersonalPurchasePaymentWatchItem(href: string): Promise<PendingItem | null> {
  const rows = await prisma.personalPurchaseOrder.findMany({
    where: { status: { in: ["PENDING_PAYMENT_METHOD", "PENDING_TRANSFER_PROOF"] } },
    select: { transferDeadlineAt: true, employee: { select: { name: true } } },
  });
  if (rows.length === 0) return null;

  const now = new Date();
  const overdue = rows.some((r) => r.transferDeadlineAt != null && r.transferDeadlineAt <= now);
  const names = rows.map((r) => r.employee.name).join(", ");
  return {
    type: "compras_personales_pago_seguimiento",
    icon: "👀",
    label: "Compras personales — esperando que el colaborador resuelva el pago",
    meta: `${rows.length === 1 ? names : `${rows.length} colaboradores`}${overdue ? " · atrasado" : ""}`,
    overdue,
    href,
  };
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
    // Confirmado 2026-08-06: la Caja Chica solo se ve dentro de la pestaña
    // "Caja Chica" del área de Finanzas — el link de admin debe apuntar a
    // esa página específica (/admin/dept/[id]), no a "/admin" a secas.
    const finDept = await prisma.department.findUnique({ where: { code: "FIN" }, select: { id: true } });
    const financeHref = finDept ? `/admin/dept/${finDept.id}` : "/admin";
    // Confirmado 2026-08-13: Control de Compras vive en la página del
    // departamento COM (Compras) — mismo criterio que financeHref arriba —
    // y ambos pendientes de pago (mercadería y flete) se pagan desde su
    // pestaña interna "Finanzas" (?ptab=finanzas, leído por
    // PurchaseControlPanel).
    const comDept = await prisma.department.findUnique({ where: { code: "COM" }, select: { id: true } });
    const comPaymentsHref = comDept ? `/admin/dept/${comDept.id}?tab=compras&ptab=finanzas` : "/admin";
    const comCreditsHref = comDept ? `/admin/dept/${comDept.id}?tab=compras&ptab=urgentes` : "/admin";
    const [feedbackItems, recognitionItem, pettyCashLow, pettyCashUnconfirmed, adminPaymentsItem, purchaseMerchandiseItem, purchaseShippingItem, purchaseCreditsItem, overtimeApprovalItem, commissionBonusApprovalItem, salaryAdvanceItem, managementDeductionItem, personalPurchaseFinanceItem, personalPurchaseTransferConfirmItem, personalPurchaseTransferCloseItem, personalPurchasePaymentWatchItem, payrollTransferItem, payrollIessTransferItem, birthdayItems] = await Promise.all([
      getFeedbackPendingItems(),
      getRecognitionAdminPendingItem("/admin/colaborador-destacado"),
      getPettyCashLowBalanceItems(financeHref),
      getPettyCashUnconfirmedFunderItems(null, financeHref),
      getAdminPaymentsPendingItem(`${financeHref}?tab=pagosadmin`),
      getPurchaseMerchandisePendingItem(comDept?.id ?? null),
      getPurchaseShippingPendingItem(comPaymentsHref),
      getPurchaseCreditsPendingItem(comCreditsHref),
      getOvertimeApprovalPendingItem("/admin/nomina?tab=pagos"),
      getCommissionAndBonusApprovalPendingItem("/admin/nomina"),
      getSalaryAdvancePendingItem("/admin/nomina?tab=pagos&ptab=anticipos"),
      getManagementDeductionUnacceptedPendingItem("/admin/nomina?tab=pagos&ptab=descuentos"),
      getPersonalPurchasePendingFinanceItem("/admin/nomina?tab=pagos&ptab=comprasfinanzas"),
      getPersonalPurchaseTransferConfirmPendingItem("/admin/nomina?tab=pagos&ptab=comprasfinanzas"),
      getPersonalPurchaseTransferClosePendingItem("/admin/nomina?tab=pagos&ptab=comprasfinanzas"),
      getPersonalPurchasePaymentWatchItem("/admin/nomina?tab=pagos&ptab=comprasfinanzas"),
      getPayrollTransferPendingItem(true, "/admin/nomina?tab=pagos&ptab=roles"),
      getPayrollIessTransferPendingItem(true, "/admin/nomina?tab=pagos&ptab=roles"),
      getUpcomingBirthdayPendingItems("/admin/nomina"),
    ]);
    const items = [
      ...feedbackItems,
      ...(recognitionItem ? [recognitionItem] : []),
      ...pettyCashLow,
      ...pettyCashUnconfirmed,
      ...(adminPaymentsItem ? [adminPaymentsItem] : []),
      ...(purchaseMerchandiseItem ? [purchaseMerchandiseItem] : []),
      ...(purchaseShippingItem ? [purchaseShippingItem] : []),
      ...(purchaseCreditsItem ? [purchaseCreditsItem] : []),
      ...(overtimeApprovalItem ? [overtimeApprovalItem] : []),
      ...(commissionBonusApprovalItem ? [commissionBonusApprovalItem] : []),
      ...(salaryAdvanceItem ? [salaryAdvanceItem] : []),
      ...(managementDeductionItem ? [managementDeductionItem] : []),
      ...(personalPurchaseFinanceItem ? [personalPurchaseFinanceItem] : []),
      ...(personalPurchaseTransferConfirmItem ? [personalPurchaseTransferConfirmItem] : []),
      ...(personalPurchaseTransferCloseItem ? [personalPurchaseTransferCloseItem] : []),
      ...(personalPurchasePaymentWatchItem ? [personalPurchasePaymentWatchItem] : []),
      ...(payrollTransferItem ? [payrollTransferItem] : []),
      ...(payrollIessTransferItem ? [payrollIessTransferItem] : []),
      ...birthdayItems,
    ];
    if (items.length === 0) return null;
    return { title: "Pendientes de esta semana", sub: "Como administrador", items };
  }

  const me = await prisma.user.findUnique({
    where: { id: actor.userId },
    select: {
      isLeader: true,
      leadsDeptId: true,
      canManagePurchases: true,
      leadsDept: { select: { code: true, name: true, trackWeeklyMetric: true } },
      department: { select: { code: true } },
    },
  });
  if (!me) return null;

  // Aplica a cualquier colaborador, líder o no — ver comentario en la
  // función.
  const myDeductionItem = await getMyManagementDeductionPendingItem(actor.userId, "/area/roles-de-pago");
  const myBankAccountItem = await getMyBankAccountPendingItem(actor.userId, "/area/roles-de-pago");
  const myPersonalPurchasePaymentItem = await getMyPersonalPurchasePaymentPendingItem(actor.userId, "/area/compras-personales");
  const myPersonalPurchaseStatusItem = await getMyPersonalPurchaseStatusPendingItem(actor.userId, "/area/compras-personales");

  // Confirmado 2026-08-18: pedido explícito del usuario — acceso directo en
  // Inicio para CUALQUIER colaborador de Inventario (no solo Daniel, su
  // líder) a la mercadería pendiente por recibir y a los cambios pendientes
  // de verificar, ahora que ambas acciones son del equipo (ver
  // canReceivePurchasesTeam en guards.ts). El resto de "Pendientes de esta
  // semana" (KPIs, Control de Inventario, etc.) sigue siendo exclusivo del
  // líder — esto es un subconjunto reducido, solo para no-líderes de INV.
  if (!me.isLeader || !me.leadsDeptId || !me.leadsDept) {
    const teamItems: PendingItem[] = [];
    if (myDeductionItem) teamItems.push(myDeductionItem);
    if (myBankAccountItem) teamItems.push(myBankAccountItem);
    if (myPersonalPurchasePaymentItem) teamItems.push(myPersonalPurchasePaymentItem);
    if (myPersonalPurchaseStatusItem) teamItems.push(myPersonalPurchaseStatusItem);
    if (me.department?.code === "INV") {
      const [receivingItem, replacementItem] = await Promise.all([
        getPurchaseReceivingPendingItem("/area/workspace?tab=compras&ptab=inventario"),
        getPurchaseReplacementVerificationPendingItem("/area/workspace?tab=compras&ptab=inventario"),
      ]);
      if (receivingItem) teamItems.push(receivingItem);
      if (replacementItem) teamItems.push(replacementItem);
    }
    if (teamItems.length === 0) return null;
    return { title: "Pendientes de esta semana", sub: me.department?.code === "INV" ? "En Inventario" : "Para ti", items: teamItems };
  }

  const items: PendingItem[] = [];
  if (myDeductionItem) items.push(myDeductionItem);
  if (myBankAccountItem) items.push(myBankAccountItem);
  if (myPersonalPurchasePaymentItem) items.push(myPersonalPurchasePaymentItem);
  if (myPersonalPurchaseStatusItem) items.push(myPersonalPurchaseStatusItem);
  let monthly = false;

  if (me.leadsDept.code === "FIN") {
    monthly = true;
    const [payStub, returnRate, warranty, paymentReminders, storeFeedback, pettyCashLow, pettyCashUnconfirmed, purchaseShippingItem, managementDeductionItem, personalPurchaseFinanceItem, personalPurchaseTransferCloseItem, personalPurchasePaymentWatchItem, merchandiseWeeklyVerificationItem, payrollTransferItem, payrollIessTransferItem] = await Promise.all([
      getPayStubPendingItem("/area/roles-de-pago"),
      getReturnRatePendingItem("/area/kpis-generales"),
      getWarrantyPendingItem("/area/kpis-generales"),
      getPaymentReminderPendingItems(me.leadsDeptId, "/area/workspace"),
      getStoreFeedbackPendingItem("/area/kpis-generales"),
      getPettyCashLowBalanceItems("/area/workspace"),
      getPettyCashUnconfirmedFunderItems(actor.userId, "/area/workspace"),
      getPurchaseShippingPendingItem("/area/workspace?tab=compras&ptab=finanzas"),
      getManagementDeductionUnacceptedPendingItem("/area/nomina?tab=pagos&ptab=descuentos"),
      getPersonalPurchasePendingFinanceItem("/area/nomina?tab=pagos&ptab=comprasfinanzas"),
      getPersonalPurchaseTransferClosePendingItem("/area/nomina?tab=pagos&ptab=comprasfinanzas"),
      getPersonalPurchasePaymentWatchItem("/area/nomina?tab=pagos&ptab=comprasfinanzas"),
      getMerchandiseWeeklyWriteOffVerificationPendingItem("/area/reingreso-mercaderia?tab=danos"),
      getPayrollTransferPendingItem(false, "/area/nomina?tab=pagos&ptab=roles"),
      getPayrollIessTransferPendingItem(false, "/area/nomina?tab=pagos&ptab=roles"),
    ]);
    items.push(...pettyCashLow, ...pettyCashUnconfirmed);
    if (payStub) items.push(payStub);
    if (returnRate) items.push(returnRate);
    if (warranty) items.push(warranty);
    items.push(...paymentReminders);
    if (storeFeedback) items.push(storeFeedback);
    if (purchaseShippingItem) items.push(purchaseShippingItem);
    if (personalPurchasePaymentWatchItem) items.push(personalPurchasePaymentWatchItem);
    if (managementDeductionItem) items.push(managementDeductionItem);
    if (personalPurchaseFinanceItem) items.push(personalPurchaseFinanceItem);
    if (personalPurchaseTransferCloseItem) items.push(personalPurchaseTransferCloseItem);
    if (merchandiseWeeklyVerificationItem) items.push(merchandiseWeeklyVerificationItem);
    if (payrollTransferItem) items.push(payrollTransferItem);
    if (payrollIessTransferItem) items.push(payrollIessTransferItem);
  }

  if (me.leadsDept.trackWeeklyMetric) {
    const item = await getWeeklyMetricPendingItem(me.leadsDeptId, "/area/workspace");
    if (item) items.push(item);
  }

  if (me.leadsDept.code === "INV") {
    const [stockoutItem, receivingItem, replacementItem, inventoryControlItem, inventoryWeeklySnapshotItem, merchandiseReentryItem, merchandiseWeeklyJustItem, personalPurchaseInventoryItem, lateClaimReviewItem, lateClaimJustItem] = await Promise.all([
      getStockoutPendingItem("/area/kpis-generales"),
      getPurchaseReceivingPendingItem("/area/workspace?tab=compras&ptab=inventario"),
      getPurchaseReplacementVerificationPendingItem("/area/workspace?tab=compras&ptab=inventario"),
      getInventoryControlPendingItem("/area/workspace?tab=inventario"),
      getInventoryWeeklySnapshotPendingItem("/area/workspace?tab=inventario"),
      getMerchandiseReentryPendingItem("/area/reingreso-mercaderia?tab=revision"),
      getMerchandiseWeeklyWriteOffJustPendingItem("/area/reingreso-mercaderia?tab=danos"),
      getPersonalPurchasePendingInventoryItem("/area/compras-personales-inventario"),
      getLateClaimReviewPendingItem("/area/workspace?tab=compras&ptab=inventario"),
      getLateClaimJustPendingItem("/area/workspace?tab=compras&ptab=inventario"),
    ]);
    if (stockoutItem) items.push(stockoutItem);
    if (receivingItem) items.push(receivingItem);
    if (replacementItem) items.push(replacementItem);
    if (inventoryControlItem) items.push(inventoryControlItem);
    if (inventoryWeeklySnapshotItem) items.push(inventoryWeeklySnapshotItem);
    if (merchandiseReentryItem) items.push(merchandiseReentryItem);
    if (merchandiseWeeklyJustItem) items.push(merchandiseWeeklyJustItem);
    if (personalPurchaseInventoryItem) items.push(personalPurchaseInventoryItem);
    if (lateClaimReviewItem) items.push(lateClaimReviewItem);
    if (lateClaimJustItem) items.push(lateClaimJustItem);
  }

  const recognitionItem = await getRecognitionLeaderPendingItem(me.leadsDeptId, "/area/colaborador-destacado");
  if (recognitionItem) items.push(recognitionItem);

  // Confirmado 2026-08-06: aplica a CUALQUIER líder, no solo Finanzas — su
  // propio equipo puede tener un cumpleaños mañana sin importar el área.
  const birthdayItems = await getUpcomingBirthdayPendingItems("/area/nomina", me.leadsDeptId, actor.userId);
  items.push(...birthdayItems);

  // Confirmado 2026-08-17: aplica a CUALQUIER líder, no solo COM/FIN — se
  // autofiltra por datos (requestedById), así que solo aparece para quien de
  // verdad tiene solicitudes de compra propias con algo pendiente.
  const purchaseRequesterItems = await getPurchaseRequesterPendingItems(actor.userId, "/area/workspace?tab=compras&ptab=mias");
  items.push(...purchaseRequesterItems);

  const supplierExchangeGestorItem = await getSupplierExchangeGestorPendingItem(actor.userId, "/area/cambio-proveedor-gestiones");
  if (supplierExchangeGestorItem) items.push(supplierExchangeGestorItem);

  // Confirmado 2026-08-17: pedido explícito del usuario — a diferencia de lo
  // anterior, esto NO es un dato propio del líder, es company-wide (todos
  // los créditos con proveedores AVAILABLE), así que solo se muestra a quien
  // de verdad puede coordinar con el proveedor: mismo criterio de elegibilidad
  // que canSubmitPurchaseRequests (guards.ts) — delegado vía
  // canManagePurchases, o líder de COM/FIN.
  if (me.canManagePurchases || ["COM", "FIN"].includes(me.leadsDept.code)) {
    const purchaseCreditsItem = await getPurchaseCreditsPendingItem("/area/workspace?tab=compras&ptab=urgentes");
    if (purchaseCreditsItem) items.push(purchaseCreditsItem);
  }

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
    types.push("feedback", "caja_chica_saldo", "caja_chica_confirmacion", "cumpleanos", "compras_creditos_pendientes", "anticipos_aprobacion", "descuentos_sin_aceptar", "compras_personales_precio", "compras_personales_transferencia", "compras_personales_cierre", "nomina_transferencia", "iess_transferencia");
  } else {
    const me = await prisma.user.findUnique({
      where: { id: actor.userId },
      select: { isLeader: true, leadsDeptId: true, canManagePurchases: true, leadsDept: { select: { code: true, trackWeeklyMetric: true } } },
    });
    if (!me?.isLeader || !me.leadsDeptId || !me.leadsDept) return [];

    types.push("cumpleanos");
    if (me.leadsDept.code === "FIN") {
      types.push("roles_de_pago", "tasa_devolucion", "kpi_garantias", "pagos_recordatorios", "servicio_postventa", "caja_chica_saldo", "caja_chica_confirmacion", "descuentos_sin_aceptar", "compras_personales_precio", "compras_personales_cierre", "reingreso_mercaderia_verificacion_semanal", "nomina_transferencia", "iess_transferencia");
    }
    if (me.leadsDept.trackWeeklyMetric) types.push("pedidos_despachados");
    if (me.leadsDept.code === "INV") {
      types.push("ruptura_stock", "compras_recepcion", "compras_cambios_verificar", "control_inventario", "control_inventario_semanal", "reingreso_mercaderia_revision", "reingreso_mercaderia_baja_just", "compras_personales_confirmar", "compras_reclamo_posterior_revision", "compras_reclamo_posterior_just");
    }
    // Mismo criterio de elegibilidad que canSubmitPurchaseRequests
    // (guards.ts) — delegado vía canManagePurchases, o líder de COM/FIN —
    // pero calculado acá sin sesión, para poder listar los tipos posibles de
    // cualquier líder (usado también por el barrido del cron).
    if (me.canManagePurchases || ["COM", "FIN"].includes(me.leadsDept.code)) {
      types.push("compras_rechazadas", "compras_orden_compra", "compras_transportista", "compras_cuenta_bancaria", "compras_creditos_pendientes");
    }
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
