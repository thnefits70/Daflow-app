import { auth } from "@/auth";
import { isAutoWarrantyMonth, WARRANTY_LAST_MANUAL_MONTH } from "@/lib/warrantyKpiConstants";
import { isAutoReturnRateMonth, RETURN_RATE_LAST_MANUAL_MONTH } from "@/lib/returnRateConstants";
import { prisma } from "@/lib/prisma";
import { evaluationDeadline, adminConfirmDeadline, summaryFieldsFromScores } from "@/lib/recognition";
import { addBusinessHours } from "@/lib/businessHours";
import { getPettyCashBoxStatuses, getPendingMotorizadoFreights, type PettyCashBoxTypeStr } from "@/lib/pettyCash";
import { getUpcomingBirthdays } from "@/lib/birthdays";
import { getFinanzasDeptId } from "@/lib/inventoryKpis";
import { isEndOfMonthQuincena, monthOfPeriod } from "@/lib/payrollCalc";
import { getMarketingLeadId } from "@/lib/guards";
import { NICHO_AUTO_MONTHLY_BUDGET_USD } from "@/lib/nichoAi";
import { getReadyToBuyPendingProposalIdsByBuyer } from "@/lib/marketProduct";
import { getNewIdBrandingBoard } from "@/lib/newIdBranding";
import { CLAIM_GAP_DAYS, findPossibleDoubleRegistrations, getSupplierClaimGaps } from "@/lib/reentrySupplierClaim";
import { ecuadorDay, getCompiledLot, isBackfillLot } from "@/lib/fulfillmentGuides";
import { holidayName, isWorkingDay, previousWorkingDay } from "@/lib/ecuadorHolidays";
import { findDuplicateCandidates } from "@/lib/catalogDuplicates";
import { fullCountCompleted, getActiveCount, getDifferences, getSubmittedCounts } from "@/lib/stockCount";
import { getAssignmentBoard, notifyLateAssignments, type AssignmentView } from "@/lib/stockCountAssignments";
import { getNegativeStockProducts } from "@/lib/stockKardex";
import { carrierLabel } from "@/lib/carriers";
import { catalogMissingDropiIdWhere } from "@/lib/catalogMissingDropiId";
import { getOpenPurchaseCodesByCatalogItem, getPurchaseLinesLeftBehind, getPurchaseLinesOverdue, getShortReceiptsUnclaimed, LEFT_BEHIND_HREF, OVERDUE_ORDERS_HREF } from "@/lib/purchases";
import { getLinesToConfirm, INVENTORY_RECEIVING_HREF } from "@/lib/purchaseLeftBehind";
import { getPurchaseSuggestionPendingItems } from "@/lib/purchaseSuggestions";
import { getSuddenDemandPendingItems } from "@/lib/suddenDemand";
import { autoResolveFoundMissingReports } from "@/lib/catalogMissingReports";
import { DISCONTINUED_URL, getDiscontinuedOrderPendingCount, getDiscontinuedPendingCount } from "@/lib/dropiDiscontinued";
import { formerLeaderIdsFor, isSummaryComplete } from "@/lib/formerLeaders";
import { getUnlinkedShanghaiCount } from "@/lib/storeTracking";
import { getCountedUnconfirmedLots, overdueCountedLots } from "@/lib/fulfillmentPicking";
import { getDropiPriceChanges } from "@/lib/dropiPriceChanges";

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

type CohortUser = { id: string; name: string; startDate: Date | null };

// Pedido del usuario 2026-10-01: un ex líder (ver formerLeaders.ts) en los
// meses en que todavía era líder lo califica el admin, no el líder de su
// área actual — se suma al grupo del admin y se saca del grupo del líder.
async function adjustForFormerLeaders(cohort: CohortUser[], evaluatorIsAdmin: boolean, month: string): Promise<CohortUser[]> {
  const ids = formerLeaderIdsFor(month);
  if (ids.length === 0) return cohort;
  if (!evaluatorIsAdmin) return cohort.filter((u) => !ids.includes(u.id));
  const toAdd = ids.filter((id) => !cohort.some((u) => u.id === id));
  if (toAdd.length === 0) return cohort;
  const extra = await prisma.user.findMany({
    where: { id: { in: toAdd }, isActive: true, excludeFromRecognition: false },
    select: { id: true, name: true, startDate: true },
  });
  return [...cohort, ...extra];
}

// IDs con el mes calificado de verdad — un líder con solo la parte de su
// equipo (Liderazgo 360°) todavía no cuenta (ver isSummaryComplete).
async function completedSummaryIds(month: string, ids: string[]): Promise<Set<string>> {
  const rows = await prisma.monthlyEvaluationSummary.findMany({
    where: { month, evaluateeId: { in: ids } },
    select: { evaluateeId: true, totalScore: true, liderazgoScore: true },
  });
  return new Set(rows.filter(isSummaryComplete).map((s) => s.evaluateeId));
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
): Promise<{ month: string; missingNames: string[] } | null> {
  const where = evaluatorIsAdmin
    ? { isLeader: true as const, isActive: true, excludeFromRecognition: false }
    : { deptId: leaderDeptId!, isLeader: false as const, isActive: true, excludeFromRecognition: false };
  const cohort = await prisma.user.findMany({ where, select: { id: true, name: true, startDate: true } });
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
    const eligible = eligibleForMonth(await adjustForFormerLeaders(cohort, evaluatorIsAdmin, month), month);
    if (eligible.length > 0) {
      const doneIds = await completedSummaryIds(month, eligible.map((u) => u.id));
      let missing = eligible.filter((u) => !doneIds.has(u.id));
      // Red de seguridad (bug real encontrado 2026-08-31): antes del
      // 2026-07-17 la evaluación detallada (MonthlyEvaluation) se podía
      // guardar sin su MonthlyEvaluationSummary — el resumen recién empezó a
      // escribirse junto con el detalle desde esa fecha. Eso dejó evaluaciones
      // ya hechas (el detalle existe, con sus scores) sin resumen, y el
      // bloqueo las contaba como "sin calificar" aunque la persona sí
      // aparecía como evaluada en la pantalla. Antes de reportar a alguien
      // como faltante, se repara el resumen a partir del detalle si existe.
      if (missing.length > 0) {
        const detailRecords = await prisma.monthlyEvaluation.findMany({
          where: { month, evaluateeId: { in: missing.map((u) => u.id) } },
          include: { scores: { select: { pillar: true, score: true } } },
        });
        for (const rec of detailRecords) {
          const fields = summaryFieldsFromScores(rec.scores);
          // Un líder cuyo Liderazgo lo pone su equipo (360°) no tiene ese
          // pilar en el detalle: se conserva el que ya estaba en el resumen.
          if (!rec.scores.some((s) => s.pillar === "liderazgo")) {
            const prev = await prisma.monthlyEvaluationSummary.findUnique({
              where: { month_evaluateeId: { month, evaluateeId: rec.evaluateeId } },
              select: { liderazgoScore: true },
            });
            if (prev?.liderazgoScore) {
              fields.totalScore += prev.liderazgoScore - fields.liderazgoScore;
              fields.liderazgoScore = prev.liderazgoScore;
            }
          }
          await prisma.monthlyEvaluationSummary.upsert({
            where: { month_evaluateeId: { month, evaluateeId: rec.evaluateeId } },
            create: { month, evaluateeId: rec.evaluateeId, ...fields },
            update: fields,
          });
        }
        const healedIds = new Set(detailRecords.map((r) => r.evaluateeId));
        missing = missing.filter((u) => !healedIds.has(u.id));
      }
      // Nota: `eligible` se calcula con la plantilla ACTUAL del equipo filtrada
      // solo por startDate (ver eligibleForMonth) — no sabe si esa persona ya
      // era líder/miembro del área en `month`. Un ascenso o cambio de área
      // reciente puede aparecer aquí como "faltante" de un mes en el que esa
      // persona en realidad no formaba parte de este grupo todavía.
      if (missing.length > 0) return { month, missingNames: missing.map((u) => u.name) };
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
  const cohort = await prisma.user.findMany({ where, select: { id: true, name: true, startDate: true } });
  const eligible = eligibleForMonth(await adjustForFormerLeaders(cohort, evaluatorIsAdmin, month), month);
  if (eligible.length === 0) return null;

  const done = (await completedSummaryIds(month, eligible.map((u) => u.id))).size;
  if (done >= eligible.length) return null;
  return { month, deadline: deadline.toISOString() };
}

// Company work week is Mon-Sat (confirmed 2026-07-20) — only Sunday and
// Ecuadorian national holidays (fixed-date list shared with
// src/lib/recognition.ts) are non-business days here. Deliberately not the
// same "weekend" definition as recognition.ts's isBusinessDay (which treats
// Saturday as off, for a different, unrelated deadline).
function isCompanyBusinessDay(date: Date): boolean {
  // Calendario automático de Ecuador (2026-10-02): domingo, feriados con
  // traslado y sábado de fin de semana largo no cuentan.
  return isWorkingDay(date.toISOString().slice(0, 10));
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
//
// Confirmed 2026-09-03: if the CURRENT week already has something recorded,
// that counts as caught up and the check stops there — it does not also
// require the previous week to be filled. Without this, a multi-week gap
// from before someone got back on track (e.g. 3 skipped weeks) would keep
// surfacing "atrasado" for the oldest unfilled week forever, even after the
// person resumed reporting normally, because nothing ever retroactively
// fills old empty weeks. Old gaps are left alone (no backfill, no separate
// alert per skipped week) — the reminder only ever looks at "did you do
// this week's, or failing that, last week's", never further back.
async function weeklyPendingStatus(
  exists: (week: string) => Promise<boolean>,
  reviewWeekday: number = 1
): Promise<{ week: string; overdue: boolean } | null> {
  const now = nowInEcuador();
  if (isoWeekdayOf(now) < reviewWeekday) return null;
  const today = isoWeekOf(now);
  if (await exists(today)) return null;
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
  mensajes_nomina_sin_leer: "Mensajes de Nómina (tu conversación)",
  mensajes_nomina_sin_leer_lider: "Mensajes de colaboradores (Nómina)",
  pagos_factura_comprobante: "Pagos por factura/comprobante",
  nomina_transferencia: "Transferencia de nómina",
  iess_transferencia: "Transferencia de IESS",
  tasa_devolucion: "Tasa de Devolución General",
  kpi_garantias: "KPI de Garantías",
  pagos_recordatorios: "Pagos recordatorios",
  servicio_postventa: "Servicio Postventa",
  pedidos_despachados: "Pedidos despachados / Fill Rate",
  fillrate_justificacion_pendiente: "Fill Rate en alerta — falta tu explicación al equipo",
  ruptura_stock: "Ruptura de Stock",
  caja_chica_saldo: "Caja Chica — saldo bajo",
  caja_chica_confirmacion: "Caja Chica — falta que confirmen una recarga",
  caja_chica_recarga_pendiente: "Caja Chica — te fondearon, falta que confirmes",
  caja_chica_flete_motorizado: "Caja Chica — flete por pagar al motorizado",
  pagos_administrativos: "Pagos administrativos pendientes de pago",
  pagos_mercaderia: "Pagos de mercadería pendientes",
  pagos_flete: "Fletes pendientes de pago",
  ventas_externas_revisar: "Ventas Externas — venta nueva por aprobar",
  ventas_externas_pago_confirmar: "Ventas Externas — comprobante de pago por confirmar",
  horas_extra_aprobacion: "Horas extra por aprobar",
  comisiones_bonos_aprobacion: "Comisiones y bonos por aprobar",
  anticipos_aprobacion: "Anticipos por aprobar",
  descuentos_sin_aceptar: "Descuentos por mala gestión sin aceptar",
  mis_descuentos_pendientes: "Tus descuentos por mala gestión — falta aceptar",
  mi_cuenta_bancaria: "Tu cuenta bancaria — falta registrarla",
  compras_personales_confirmar: "Compras personales — falta confirmar producto/cantidad",
  compras_personales_precio: "Compras personales — falta cerrar el precio",
  compras_personales_esperando_costo: "Compras personales — esperando costo en INVESTOCK",
  compras_personales_transferencia: "Compras personales — comprobante por confirmar",
  compras_personales_cierre: "Compras personales — transferencia confirmada, falta cerrar",
  compras_personales_metodo_pago: "Tus compras personales — falta que elijas cómo pagar o subas el comprobante",
  compras_personales_estado: "Tus compras personales — seguimiento del estado (mientras esperás a bodega o Finanzas)",
  compras_personales_pago_seguimiento: "Compras personales — seguimiento de pagos pendientes del colaborador",
  reingreso_mercaderia_revision: "Reingreso de mercadería por revisar",
  reingreso_mercaderia_verificacion_semanal: "Reingreso de mercadería — lote semanal de dañados por verificar",
  egresos_deterioro_resolucion: "Deterioro en bodega — falta tu decisión",
  lotes_caducidad_alerta: "Productos vencidos o que vencen en 6 meses o menos",
  ids_sin_marca: "Productos o combos sin marca o sin ID de Dropi",
  productos_sin_area: "Productos sin área de bodega (A…G)",
  reclamos_proveedor_atrasados: "Reclamos al proveedor trabados o pasados por alto",
  danados_doble_registro: "Producto dañado registrado dos veces (devolución + deterioro)",
  ventas_externas_agrupar: "Ventas Externas — asignar quién agrupa",
  ventas_externas_embalar: "Ventas Externas — asignar quién embala y entrega",
  garantia_local_recogida: "Garantía local — confirmar lo que trajo el motorizado",
  garantia_local_resultado: "Tus garantías locales — confirmar si se entregaron",
  manifiestos_tras_feriado: "Manifiestos pendientes después de domingo o feriado",
  catalogo_posibles_duplicados: "Posibles productos duplicados por revisar",
  conteo_inventario: "Conteo físico de inventario (general o área de la semana)",
  conteo_inventario_aprobar: "Conteo físico — diferencias por aprobar",
  stock_negativo: "Productos con stock negativo",
  cumpleanos: "Cumpleaños de tu equipo (aviso 1 día antes)",
  compras_pendientes_aprobacion: "Solicitudes de compra por aprobar",
  compras_rechazadas: "Tus solicitudes de compra rechazadas — corregir y reenviar",
  compras_transportista: "Tus solicitudes de compra — falta transportista",
  compras_cuenta_bancaria: "Tus solicitudes de compra — cambiar cuenta bancaria",
  compras_pago_seguimiento: "Tus solicitudes de compra — seguimiento después del pago (mientras Inventario confirma la recepción)",
  compras_recepcion: "Control de Compras — confirmar mercadería recibida",
  compras_cambios_verificar: "Control de Compras — verificar cambios de mercadería",
  compras_reclamo_posterior_revision: "Reclamos posteriores al cierre por revisar",
  compras_creditos_pendientes: "Créditos pendientes de recuperar",
  deterioro_compras_gestion: "Deterioro escalado — pendiente de gestionar con el proveedor",
  compras_excedente_gestion: "Excedente de mercadería — pendiente de gestionar con el proveedor",
  compras_excedente_confirmar: "Excedente de mercadería — pendiente de tu confirmación",
  compras_excedente_kardex: "Excedente de mercadería — confirmado, falta ingresarlo al Kardex",
  deterioro_compras_excepcion: "Deterioro sin compra que lo respalde — tu decisión",
  ajuste_stock_conteo: "Ajuste de stock por conteo físico — por aprobar",
  correccion_precio_compra: "Corrección de precio de compra — por aprobar",
  perdida_compra_aprobar: "Pérdida en reclamo de compra — por aprobar",
  catalogo_compras_borrado: "Solicitudes de borrar productos del catálogo de compras",
  cuenta_proveedor_verificar: "Cuentas bancarias de proveedores por verificar",
  caja_chica_excepcion_flete: "Caja Chica — excepción de flete por aprobar",
  sueldo_nairoby_transferencia: "Transferencia del sueldo de Nairoby",
  plan_mejora_admin: "Plan de Mejora que tú abriste — evaluación o etapa vencida",
  catalogo_producto_faltante: "Productos reportados como faltantes en el catálogo",
  control_inventario: "Control de Inventario — captura mensual",
  combo_sugerencias_nicho_backfill: "Sugerencias de Combos — nichos por asignar (tope de gasto alcanzado)",
  plan_mejora_evaluacion_pendiente: "Plan de Mejora — evaluación semanal pendiente",
  plan_mejora_etapa_vencida: "Plan de Mejora — etapa vencida, falta decidir cómo siguió",
  plan_mejora_cierre_aprobacion: "Plan de Mejora — cierre de un líder por aprobar",
  analisis_mercado_aprobacion: "Análisis de Mercado — propuestas por aprobar",
  analisis_mercado_sin_compra: "Análisis de Mercado — aprobados con compra rechazada",
  analisis_mercado_listo_comprar: "Análisis de Mercado — productos listos para comprar",
  analisis_mercado_rechazadas: "Análisis de Mercado — mis propuestas rechazadas",
  analisis_mercado_aprobadas_sin_compra: "Análisis de Mercado — mis propuestas aprobadas sin compra",
  analisis_mercado_brandear: "Nuevos IDs por brandear",
  analisis_mercado_sin_id: "Productos de Compras sin ID de Dropi",
  seguimiento_tiendas_sin_tienda: "Seguimiento de tiendas — productos de Shanghai sin tienda",
  analisis_mercado_compra_en_camino: "Ya se está comprando — publícalo en Dropi",
  precio_dropi_cambio: "Cambió el precio mínimo de un producto publicado en Dropi",
  combos_semana: "Combos sugeridos de la semana por revisar",
  fulfillment_corte_enviado: "Corte de Fulfillment enviado — falta despacharlo",
  fulfillment_bloque_asignado: "Bloque del corte asignado — sacar de bodega",
  compras_calientes: "Compras calientes (30 unidades o menos)",
  compras_frias: "Compras frías (31 a 60 unidades)",
  compras_urgentes_sin_atender: "Compras urgentes sin atender (3+ días)",
};

// "colaborador_del_mes" es obligatorio — confirmado 2026-08-05: a diferencia
// de todo lo demás en este archivo, el líder NO puede apagar este push. Por
// eso deliberadamente no está en PENDING_TYPE_CATALOG ni en
// getPossiblePendingTypesForActor (no aparece en "Preferencias de
// notificaciones" para desactivarlo) y el cron lo manda sin mirar
// getDisabledTypes. Deja de aparecer solo/naturalmente en cuanto el líder ya
// no tiene a nadie pendiente de calificar — nunca por elección propia.
// "cambio_proveedor_rechazo" (confirmado 2026-08-27, pedido explícito del
// usuario) es igual de obligatorio: cuando un proveedor rechaza un cambio es
// dinero/mercadería en riesgo de perderse — nadie (admin, Nairoby, Daniel)
// debe poder silenciarlo por accidente.
// "analisis_mercado_liberar_kardex" (confirmado 2026-09-28, pedido explícito
// del usuario): mercadería ya en bodega que no aparece en INVESTOCK hasta que
// Bryan la libere — se le pasó por semanas porque solo tenía un aviso único.
export const MANDATORY_PUSH_TYPES = new Set(["fulfillment_cortes_sin_confirmar", "kardex_atrasado_cortes", "kardex_atrasado_recepciones", "kardex_atrasado_liberar", "colaborador_del_mes", "cambio_proveedor_rechazo", "analisis_mercado_liberar_kardex"]);

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

// Pedido puntual del usuario 2026-09-03: apagar la alerta de Fulfillment en
// Inicio hasta el 6 de septiembre — ya hay una revisión programada para el
// 5 de septiembre (tarea "check-fulfillment-feedback") y no quiere ver el
// rojo mientras tanto. Esto NO significa que el pendiente esté resuelto,
// solo deja de mostrarse acá durante esa ventana; pasada la fecha vuelve a
// evaluarse con la lógica normal de weeklyPendingStatus. Quitar esta
// entrada (o todo el bloque de abajo que la usa) una vez que ya no aplique.
const FEEDBACK_SNOOZED_UNTIL: Record<string, string> = {
  FUL: "2026-09-06",
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
    const snoozedUntil = FEEDBACK_SNOOZED_UNTIL[d.code];
    if (snoozedUntil) {
      const d0 = nowInEcuador();
      const todayStr = `${d0.getUTCFullYear()}-${pad2(d0.getUTCMonth() + 1)}-${pad2(d0.getUTCDate())}`;
      if (todayStr < snoozedUntil) continue;
    }

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

// Confirmado 2026-09-12: la exigencia de justificación recién se creó el
// 2026-09-08 (mismo corte que fillRateJustificationRuleAppliesTo en
// dashboard.ts — no se importa de ahí para no crear un ciclo, dashboard.ts
// ya importa de este archivo) — no tiene sentido recordarle a Yair una
// semana de antes de esa fecha, la regla no existía cuando se registró.
const FILL_RATE_JUSTIFICATION_RULE_START = new Date(Date.UTC(2026, 8, 8));

// Confirmado 2026-09-08: pedido explícito del usuario — hasta ahora, una vez
// que una semana quedaba en alerta (<95%, mismo umbral que needsJustification
// en dashboard.ts), la explicación del líder de Fulfillment podía quedar
// pendiente indefinidamente sin que nada se lo recordara (solo aparecía el
// aviso pasivo en FillRateBreakdownCard). Mira la semana MÁS RECIENTE que ya
// tenga el desglose completo (prepared/generated/outOfStock) — mismo criterio
// que getLatestFillRateBreakdown — y solo avisa si esa semana quedó bajo 95%
// y todavía no tiene justificación guardada.
async function getFillRateJustificationPendingItem(deptId: string, href: string): Promise<PendingItem | null> {
  const record = await prisma.weeklyMetricRecord.findFirst({
    where: { deptId, prepared: { not: null }, generated: { not: null }, outOfStock: { not: null } },
    orderBy: { week: "desc" },
  });
  if (!record || record.fillRateJustification) return null;
  if (mondayOfIsoWeek(record.week) < FILL_RATE_JUSTIFICATION_RULE_START) return null;

  const total = record.value + (record.prepared ?? 0) + (record.generated ?? 0) + (record.outOfStock ?? 0);
  if (total === 0) return null;
  const fillRatePct = Math.round((record.value / total) * 100);
  if (fillRatePct >= 95) return null;

  return {
    type: "fillrate_justificacion_pendiente",
    icon: "📦",
    label: "Fill Rate en alerta — falta tu explicación al equipo",
    meta: `${formatWeekLabel(record.week)} · ${fillRatePct}% · atrasado`,
    overdue: true,
    href,
  };
}

// Pedido del usuario 2026-09-30: Ruptura de Stock se arma sola con los
// cortes (autoStockout.ts) — Daniel ya no tiene nada que cargar, así que ya
// no le sale como pendiente.

// Reescrito 2026-08-31 — hasta el 2026-08-24 esto contaba comprobantes
// (PayStub) subidos a mano por Nairoby; ese flujo se retiró (commit
// 47f7b44, "Auto-generate the Rol del mes... retire manual comprobante
// uploads") a favor del Rol del mes automático (MonthlyLegalRole), que se
// genera solo al publicar la quincena de fin de mes — ver publish/route.ts.
// Mirar solo PayStub habría hecho que este aviso marcara a TODO el equipo
// como "faltante" cada mes desde agosto en adelante, porque ya nadie sube
// un PayStub nuevo. Pero mirar solo MonthlyLegalRole tampoco alcanza: julio
// 2026 se cerró 100% con el sistema viejo (comprobante a mano) ANTES de que
// existiera el Rol del mes automático (shippeado 2026-08-13), así que no
// tiene ni un solo MonthlyLegalRole — un swap directo habría disparado una
// alarma falsa mucho peor (todo el equipo "faltante" de julio) el mismo día
// de este fix. Por eso cuenta a alguien como cubierto si tiene CUALQUIERA
// de los dos para ese mes — cubre correctamente el mes de transición (vía
// PayStub) sin fecha de corte fija, y de ahí en adelante el OR se reduce
// solo a MonthlyLegalRole porque PayStub ya no recibe filas nuevas. Con el
// sistema nuevo, "falta" significa: la quincena de fin de mes de esa
// persona todavía no se publicó, o su sueldo declarado en IESS no está
// configurado (publish/route.ts la salta en silencio si
// PayrollProfile.iessDeclaredSalary es null) — ambos resolubles por
// Nairoby desde Roles de pago.
async function countMissingPayStubs(month: number, year: number): Promise<number> {
  const monthStr = `${year}-${pad2(month)}`;
  const [activeUsers, stubs, roles, externalProfiles] = await Promise.all([
    prisma.user.findMany({ where: { isActive: true }, select: { id: true, startDate: true } }),
    prisma.payStub.findMany({ where: { month, year }, select: { userId: true } }),
    prisma.monthlyLegalRole.findMany({ where: { month: monthStr, isCurrent: true }, select: { employeeId: true } }),
    prisma.payrollProfile.findMany({ where: { externalPaymentMode: true }, select: { userId: true } }),
  ]);
  // Fix confirmado 2026-08-31 (caso real: Elsa Yambay, ingresó 2026-08-14)
  // — mismo bug que eligibleForMonth ya resuelve para Colaborador del mes:
  // sin filtrar por startDate, alguien contratado en agosto aparecía como
  // "faltante" del rol de pago de julio, un mes en el que ni siquiera
  // trabajaba acá.
  // Fix confirmado 2026-09-09 (caso real: Robert, Allan, Bryan, Heidy,
  // Mercedes, Elsa, Joel, Luis Castillo) — quien está en modo de pago
  // externo (factura/comprobante, ver PayrollProfile.externalPaymentMode)
  // nunca tiene ni PayStub ni MonthlyLegalRole porque no le corresponden;
  // sin excluirlos acá quedaban "faltantes" todos los meses para siempre.
  // Su propio control vive en ExternalPayment, ver
  // getExternalPaymentPendingItem.
  const externalIds = new Set(externalProfiles.map((p) => p.userId));
  const eligible = eligibleForMonth(activeUsers, monthStr).filter((u) => !externalIds.has(u.id));
  const coveredIds = new Set([...stubs.map((s) => s.userId), ...roles.map((r) => r.employeeId)]);
  return eligible.filter((u) => !coveredIds.has(u.id)).length;
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

// Confirmado 2026-09-09: pedido explícito del usuario — control aparte para
// quien está en modo de pago externo (PayrollProfile.externalPaymentMode,
// ver countMissingPayStubs de arriba). Mismo patrón día-3 que Roles de pago
// (mira el mes anterior, recién avisa pasado el plazo), pero contando
// ExternalPayment en vez de PayStub/MonthlyLegalRole.
async function countMissingExternalPayments(monthStr: string): Promise<number> {
  const [activeUsers, externalProfiles, payments] = await Promise.all([
    prisma.user.findMany({ where: { isActive: true }, select: { id: true, startDate: true } }),
    prisma.payrollProfile.findMany({ where: { externalPaymentMode: true }, select: { userId: true, externalPaymentModeSince: true } }),
    prisma.externalPayment.findMany({ where: { month: monthStr }, select: { userId: true } }),
  ]);
  // externalPaymentModeSince filtra transiciones a mitad de camino — ver su
  // comentario en schema.prisma. Sin since (null), se exige desde siempre.
  const externalIds = new Set(
    externalProfiles.filter((p) => !p.externalPaymentModeSince || monthStr >= p.externalPaymentModeSince).map((p) => p.userId)
  );
  const eligible = eligibleForMonth(activeUsers, monthStr).filter((u) => externalIds.has(u.id));
  const paidIds = new Set(payments.map((p) => p.userId));
  return eligible.filter((u) => !paidIds.has(u.id)).length;
}

async function getExternalPaymentPendingItem(href: string): Promise<PendingItem | null> {
  const today = currentMonthStr();
  const prev = prevMonthStr(today);

  if (fixedDayDeadlinePassed(today, 3)) {
    const missing = await countMissingExternalPayments(prev);
    if (missing > 0) {
      return {
        type: "pagos_factura_comprobante",
        icon: "🧾",
        label: "Pagos por factura/comprobante",
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
  // Desde octubre 2026 la tasa se calcula sola. Pedido del usuario
  // 2026-10-03: el último mes a mano (septiembre) se recuerda SIEMPRE hasta
  // que se cargue — antes se miraba solo "el mes anterior" y en noviembre el
  // aviso habría desaparecido aunque septiembre nunca se cargara.
  const month = isAutoReturnRateMonth(prev) ? RETURN_RATE_LAST_MANUAL_MONTH : prev;
  const due = month !== prev || fixedDayDeadlinePassed(today, 4);
  if (due && !(await prisma.returnRateRecord.findUnique({ where: { month } }))) {
    return {
      type: "tasa_devolucion",
      icon: "📉",
      label: "Tasa de Devolución General",
      meta: `${formatMonthLabel(month)} · copiar el % de ATOM · atrasado`,
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
  // Desde octubre 2026 el mes se llena solo con los cortes. 2026-10-03: igual
  // que la Tasa, septiembre (último mes a mano) se recuerda siempre hasta
  // tener el total Y los motivos — el aviso dice cuál falta.
  const month = isAutoWarrantyMonth(prev) ? WARRANTY_LAST_MANUAL_MONTH : prev;
  if (month === prev && !fixedDayDeadlinePassed(today, 1)) return null;
  const [total, motives] = await Promise.all([
    prisma.warrantyMonthTotal.findUnique({ where: { month } }),
    prisma.warrantyCategoryMonthCount.count({ where: { month } }),
  ]);
  if (total && motives > 0) return null;
  const missing = !total && motives === 0 ? "total y motivos" : !total ? "falta el total" : "faltan los motivos";
  return {
    type: "kpi_garantias",
    icon: "🛡️",
    label: "KPI de Garantías",
    meta: `${formatMonthLabel(month)} · ${missing} · atrasado`,
    overdue: true,
    href,
  };
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
  const eligible = eligibleForMonth(await adjustForFormerLeaders(evaluatees, evaluatorIsAdmin, month), month);
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
    // Un ex líder (formerLeaders.ts) puede salir en las dos listas.
    const missing = [...missingLeaders, ...missingTeam.filter((u) => !missingLeaders.some((l) => l.id === u.id))];
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

// El aviso "check_in_semanal_estancado" que vivía acá (confirmado
// 2026-08-27, corregido 2026-08-31) se retiró 2026-09-22: pedido explícito
// del usuario — un líder 2+ semanas atrasado ahora queda bloqueado de la
// parte administrativa de su propio panel hasta resolverlo con Mary (ver
// getWeeklyCheckinLockoutStatus en weeklyCheckin.ts, AreaGateShell.tsx y
// DeptWorkspaceTabs.tsx), en vez de depender de que admin lo persiga cada
// vez. El bloqueo se encarga solo.

// Confirmado 2026-08-05: el aviso de saldo bajo le llega tanto a admin como
// a Nairoby (líder de Finanzas) — cualquiera de los dos puede recargar.
// Confirmado 2026-08-06: el link "Ir →" debe llevar directo a la pestaña
// "Caja Chica" y hacer scroll+resaltado sobre la caja específica (Principal
// o Secundaria) — no solo a la página general — así que hrefBase (la página
// de destino, sin query) se recibe ya resuelta por el llamador y acá solo se
// le agregan los parámetros que DeptWorkspaceTabs/PettyCashPanel leen.
async function getPettyCashLowBalanceItems(hrefBase: string): Promise<PendingItem[]> {
  const items: PendingItem[] = [];
  for (const box of await getPettyCashBoxStatuses()) {
    if (box.isLow) {
      items.push({
        type: "caja_chica_saldo",
        icon: "💰",
        label: `Caja Chica ${box.type === "PRINCIPAL" ? "Principal" : "Secundaria"} con saldo bajo`,
        meta: box.reserved > 0
          ? `Libre $${box.available.toFixed(2)} ($${box.reserved.toFixed(2)} apartado) · mínimo $${box.minThreshold.toFixed(2)} · atrasado`
          : `$${box.balance.toFixed(2)} · mínimo $${box.minThreshold.toFixed(2)} · atrasado`,
        overdue: true,
        href: `${hrefBase}?tab=cajachica&box=${box.type.toLowerCase()}`,
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

// Confirmado 2026-08-31: pedido explícito del usuario — a quien le TOCA
// confirmar una recarga (no a quien la fondeó) antes solo le llegaba una
// notificación push única en el momento del fondeo; si se le pasaba, no
// tenía ningún aviso en Inicio que lo llevara de vuelta a confirmar. Mismo
// criterio de "quién es el destinatario" que ya usa /api/petty-cash/recharge
// al mandar ese push — aplica a cualquier colaborador, sea líder o no (ej.
// Bryan en Secundaria no lidera ningún departamento). A diferencia de
// getPettyCashUnconfirmedFunderItems, este aparece de inmediato (no espera
// 8h) porque es el aviso principal, no un recordatorio de atraso.
// Confirmado 2026-09-22, pedido de Marcos (aprobado por el usuario): además
// de la notificación única, el flete por pagar al motorizado queda en
// Pendientes de Nairoby (Principal) y de quien tenga la Secundaria (Jariel)
// hasta que alguno de los dos lo pague — misma lista que muestra Caja Chica
// (getPendingMotorizadoFreights), así que desaparece sola al pagarse.
async function getMyMotorizadoFreightPendingItems(userId: string, hrefBase: string): Promise<PendingItem[]> {
  const me = await prisma.user.findUnique({
    where: { id: userId },
    select: { isLeader: true, leadsDept: { select: { code: true } }, canManagePettyCashSecundaria: true },
  });
  if (!me) return [];
  const box = me.isLeader && me.leadsDept?.code === "FIN" ? "principal" : me.canManagePettyCashSecundaria ? "secundaria" : null;
  if (!box) return [];
  const rows = await getPendingMotorizadoFreights(userId);
  return rows.map((r) => ({
    type: "caja_chica_flete_motorizado",
    icon: "🛵",
    label: `Pagar flete al motorizado: ${r.label}`,
    meta: "El cliente ya recibió el pedido — págalo desde Caja Chica.",
    overdue: false,
    href: `${hrefBase}?tab=cajachica&box=${box}`,
  }));
}

async function getMyPettyCashConfirmationPendingItems(userId: string, hrefBase: string): Promise<PendingItem[]> {
  const me = await prisma.user.findUnique({
    where: { id: userId },
    select: { isLeader: true, leadsDept: { select: { code: true } }, canManagePettyCashSecundaria: true },
  });
  if (!me) return [];
  const boxTypes: PettyCashBoxTypeStr[] = [];
  if (me.isLeader && me.leadsDept?.code === "FIN") boxTypes.push("PRINCIPAL");
  if (me.canManagePettyCashSecundaria) boxTypes.push("SECUNDARIA");
  if (boxTypes.length === 0) return [];

  const rows = await prisma.pettyCashEntry.findMany({
    where: { kind: "RECARGA", confirmedAt: null, archived: false, box: { type: { in: boxTypes } } },
    include: { box: true },
  });
  return rows.map((r) => ({
    type: "caja_chica_recarga_pendiente",
    icon: "💰",
    label: `Confirma que recibiste $${r.amount.toFixed(2)} en Caja Chica ${r.box.type === "PRINCIPAL" ? "Principal" : "Secundaria"}`,
    meta: "Te fondearon la caja — falta que confirmes que la recibiste.",
    overdue: false,
    href: `${hrefBase}?tab=cajachica&box=${r.box.type.toLowerCase()}`,
  }));
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

// Cálculo compartido. Confirmado 2026-08-17: originalmente sumaba también
// PENDING_APPROVAL porque quien pagaba (admin) también aprobaba, así que
// aprobar y pagar quedaban en el mismo paso. Corregido 2026-09-04 tras
// feedback del usuario: desde la transición Bryan→Jariel, aprobar (Bryan) y
// pagar (admin) son pasos de personas distintas — admin veía "pendiente de
// pagar" mercadería que Bryan todavía ni había revisado. Ahora solo cuenta
// APPROVED (lo que de verdad ya se puede pagar); lo PENDING_APPROVAL le
// aparece a quien aprueba, ver getPurchaseApprovalPendingItem más abajo.
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

  // Confirmado 2026-09-14, mismo bug real reportado por el usuario que en
  // PurchaseInvoicingPanel.tsx: un proveedor de crédito (hoy CHEN) nunca se
  // paga por solicitud individual — se excluye acá también para que esta
  // tarjeta de Inicio no mande a "pagar" algo que en realidad se paga por
  // tanda desde "Proveedores con Crédito".
  const approvedRows = await prisma.purchaseRequest.findMany({
    where: { status: "APPROVED", supplier: { paymentMode: { not: "CREDITO" } } },
    select: { groupId: true, totalCost: true, reviewedAt: true },
  });

  const approvedGroups = groupRows(approvedRows.map((r) => ({ groupId: r.groupId, totalCost: r.totalCost, at: r.reviewedAt })));

  const overdue = approvedGroups.some((g) => g.at && g.at < cutoff);
  const total = approvedGroups.reduce((s, g) => s + g.total, 0);

  return { count: approvedGroups.length, total, overdue, href: `${base}?tab=compras&ptab=finanzas` };
}

// Confirmado 2026-09-04: pedido explícito del usuario — contraparte de
// getPurchaseMerchandisePaymentsSummary, para quien APRUEBA (hoy Bryan, ver
// canApprovePurchaseRequests en guards.ts) en vez de quien paga. Cuenta
// PENDING_APPROVAL, company-wide igual que getPurchaseCreditsPendingItem
// (no hay un "approverId" — cualquiera con el flag ve la misma bandeja).
async function getPurchaseApprovalPendingItem(href: string): Promise<PendingItem | null> {
  const cutoff = new Date(Date.now() - 24 * 60 * 60 * 1000);
  const rows = await prisma.purchaseRequest.findMany({
    where: { status: "PENDING_APPROVAL" },
    select: { groupId: true, totalCost: true, requestedAt: true },
  });
  if (rows.length === 0) return null;

  const byGroup = new Map<string, { total: number; at: Date }>();
  for (const r of rows) {
    const cur = byGroup.get(r.groupId) ?? { total: 0, at: r.requestedAt };
    cur.total += r.totalCost;
    byGroup.set(r.groupId, cur);
  }
  const groups = [...byGroup.values()];
  const overdue = groups.some((g) => g.at < cutoff);
  const total = groups.reduce((s, g) => s + g.total, 0);

  return {
    type: "compras_pendientes_aprobacion",
    icon: "✅",
    label: "Solicitudes de compra por aprobar",
    meta: `${groups.length} solicitud${groups.length === 1 ? "" : "es"} · $${total.toFixed(2)}${overdue ? " · atrasado" : ""}`,
    overdue,
    href,
  };
}

// Confirmado 2026-09-18, pedido de Jariel vía Bryan: contraparte en Inicio
// del aviso de campanita que se agregó al proponer un producto (ver
// notifyOwner en api/market-products/route.ts) — para que a Bryan también le
// quede un acceso directo aunque se le haya pasado el push. Company-wide
// igual que getPurchaseApprovalPendingItem, mismo criterio (bandeja única de
// quien aprueba, no hay "approverId" por fila).
async function getMarketProductReviewPendingItem(href: string): Promise<PendingItem | null> {
  const cutoff = new Date(Date.now() - 24 * 60 * 60 * 1000);
  const rows = await prisma.marketProductProposal.findMany({
    where: { status: "PENDING_APPROVAL" },
    select: { proposedAt: true },
  });
  if (rows.length === 0) return null;
  const overdue = rows.some((r) => r.proposedAt < cutoff);

  return {
    type: "analisis_mercado_aprobacion",
    icon: "🏆",
    label: "Propuestas de productos por aprobar",
    meta: `${rows.length} propuesta${rows.length === 1 ? "" : "s"}${overdue ? " · atrasado" : ""}`,
    overdue,
    href,
  };
}

// Pedido del usuario 2026-10-03 (AM-0018 "Casco de Gateo para Bebe"): una
// propuesta aprobada cuya compra Bryan rechazó quedaba "aprobada" para
// siempre sin que nadie la cerrara. Le sale a Bryan hasta que decida:
// cancelarla (botón en Trazabilidad) o volver a comprarla (Jariel reenvía la
// compra → ya hay compra viva y deja de salir). Solo sin publicar en Dropi.
export async function getMarketProposalsWithRejectedPurchaseIds(): Promise<{ id: string; code: string; productName: string }[]> {
  const rows = await prisma.marketProductProposal.findMany({
    where: { status: "APPROVED", publishedAt: null, catalogItemId: { not: null } },
    select: { id: true, code: true, productName: true, catalogItemId: true },
  });
  if (rows.length === 0) return [];
  const purchases = await prisma.purchaseRequest.findMany({
    where: { catalogItemId: { in: rows.map((r) => r.catalogItemId!) } },
    select: { catalogItemId: true, status: true },
  });
  return rows.filter((r) => {
    const mine = purchases.filter((p) => p.catalogItemId === r.catalogItemId);
    return mine.length > 0 && mine.every((p) => p.status === "REJECTED");
  });
}

async function getMarketProposalRejectedPurchasePendingItem(href: string): Promise<PendingItem | null> {
  const rows = await getMarketProposalsWithRejectedPurchaseIds();
  if (rows.length === 0) return null;
  return {
    type: "analisis_mercado_sin_compra",
    icon: "🗂️",
    label: "Productos aprobados con su compra rechazada — ¿se cancelan o se vuelven a comprar?",
    meta: rows.length === 1 ? `${rows[0].code} ${rows[0].productName}` : `${rows.length} propuestas`,
    overdue: false,
    href,
  };
}

// Confirmado 2026-09-18, mismo pedido: contraparte para Jariel de la vista
// "Listo para comprar" (view=ready-to-buy en api/market-products/route.ts) —
// lo que Bryan ya decidió comprar y todavía no tiene ninguna solicitud de
// compra real generada.
// Pedido del usuario 2026-10-05: "cold" = lo que propuso el líder de
// Finanzas (Nairoby, compras frías); "hot" = el resto (Jariel).
async function getMarketProductReadyToBuyPendingItem(href: string, buyer: "hot" | "cold" = "hot"): Promise<PendingItem | null> {
  const cutoff = new Date(Date.now() - 24 * 60 * 60 * 1000);
  const pendingIds = (await getReadyToBuyPendingProposalIdsByBuyer())[buyer];
  if (pendingIds.length === 0) return null;
  const rows = await prisma.marketProductProposal.findMany({
    where: { id: { in: pendingIds } },
    select: { readyToBuyAt: true },
  });
  if (rows.length === 0) return null;
  const overdue = rows.some((r) => r.readyToBuyAt! < cutoff);

  return {
    type: "analisis_mercado_listo_comprar",
    icon: "🛒",
    label: "Productos listos para comprar",
    meta: `${rows.length} producto${rows.length === 1 ? "" : "s"}${overdue ? " · atrasado" : ""}`,
    overdue,
    href,
  };
}

// Confirmado 2026-09-28, pedido explícito del usuario: Daniel vio productos
// comprados y recibidos (190075, 190752…) con stock 0 en INVESTOCK — estaban
// esperando que Bryan apretara "Confirmar y liberar al Kardex", que solo
// vivía en la pestaña Trazabilidad con un aviso único al publicar. Ahora es
// pendiente obligatorio (ver MANDATORY_PUSH_TYPES) en cuanto ya depende solo
// de él: Heidy confirmó el ID de Dropi Y hay mercadería recibida esperando.
// Si todavía no llegó nada, no se le pide (no hay nada que se vea mal).
export async function getMarketProductKardexReleasePendingRows() {
  const rows = await prisma.marketProductProposal.findMany({
    where: {
      publishedAt: { not: null },
      dropiProductId: { not: null },
      kardexReleasedAt: null,
      catalogItem: { awaitingDropiId: true },
    },
    select: {
      id: true,
      publishedAt: true,
      catalogItem: {
        select: {
          requests: {
            where: { status: "RECEIVED", receipt: { approvedAt: { not: null }, stockKardexEntry: null } },
            select: { receipt: { select: { approvedAt: true, receivedQuantity: true } } },
          },
        },
      },
    },
  });
  return rows
    .map((r) => {
      const receipts = (r.catalogItem?.requests ?? []).map((pr) => pr.receipt!).filter(Boolean);
      if (receipts.length === 0) return null;
      // Desde cuándo depende solo de Bryan: lo último entre la publicación y la llegada más antigua.
      const firstArrival = receipts.reduce((min, x) => (x.approvedAt! < min ? x.approvedAt! : min), receipts[0].approvedAt!);
      const since = firstArrival > r.publishedAt! ? firstArrival : r.publishedAt!;
      return { id: r.id, since, units: receipts.reduce((s, x) => s + x.receivedQuantity, 0) };
    })
    .filter((r): r is { id: string; since: Date; units: number } => r !== null);
}

async function getMarketProductKardexReleasePendingItem(href: string): Promise<PendingItem | null> {
  const rows = await getMarketProductKardexReleasePendingRows();
  if (rows.length === 0) return null;
  const cutoff = new Date(Date.now() - 24 * 60 * 60 * 1000);
  const overdue = rows.some((r) => r.since < cutoff);
  const units = rows.reduce((s, r) => s + r.units, 0);

  return {
    type: "analisis_mercado_liberar_kardex",
    icon: "📦",
    label: "Liberar al Kardex — mercadería en bodega sin INVESTOCK",
    meta: `${rows.length} producto${rows.length === 1 ? "" : "s"} · ${units} un.${overdue ? " · atrasado" : ""}`,
    overdue,
    href,
  };
}

// Confirmado 2026-09-22, pedido explícito del usuario: contraparte en Inicio
// del aviso que le llega a Robert (canBrandMarketProduct) apenas Heidy
// confirma el ID de Dropi (ver publish/route.ts) — mismo filtro que su
// pestaña "Brandear" (view=brand en api/market-products/route.ts).
// Confirmado 2026-09-23: ahora cuenta los "Nuevos IDs por brandear" (propuestas
// con ID de Dropi + productos que llegan por primera vez), ya no solo las
// propuestas, y le aparece también a Robert (canConfirmMarketingDesign).
async function getMarketProductBrandPendingItem(href: string): Promise<PendingItem | null> {
  const cutoff = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
  // Confirmado 2026-09-25: también cuenta los ya brandeados que llegaron a
  // bodega y esperan sus imágenes reales (los que no han llegado no piden nada).
  const { pending: rows, realPhotos } = await getNewIdBrandingBoard();
  const photoRows = realPhotos.filter((r) => r.arrivedAt);
  if (rows.length === 0 && photoRows.length === 0) return null;
  const overdue = rows.some((r) => r.since !== "" && r.since < cutoff);
  const parts = [
    rows.length > 0 ? `${rows.length} por brandear` : "",
    photoRows.length > 0 ? `${photoRows.length} para imágenes reales` : "",
  ].filter(Boolean);

  return {
    type: "analisis_mercado_brandear",
    icon: "🎨",
    label: "Nuevos IDs por brandear",
    meta: `${parts.join(" · ")}${overdue ? " · atrasado" : ""}`,
    overdue,
    href,
  };
}

// Confirmado 2026-09-15, pedido explícito del usuario: esto duplicaba
// exactamente la misma información que ya muestra la tarjeta destacada de
// "Pagos de mercadería pendientes" arriba de esta lista (ver Dashboard.tsx,
// getPurchaseMerchandisePaymentsShortcut) — el usuario prefiere ver esa
// tarjeta sola, mejor separada, sin repetirla acá abajo.

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
    where: {
      shippingIncluded: false,
      shippingPaidAt: null,
      OR: [
        { shippingPaymentTiming: "ON_DELIVERY", shippingPaymentRequestedAt: { not: null } },
        // Pedido del usuario 2026-10-05 (SC-150): flete "junto con la compra"
        // que quedó sin pagar aunque la mercadería ya se pagó.
        { shippingPaymentTiming: "WITH_PURCHASE", shippingPaymentMethod: { not: "PETTY_CASH" }, shippingCostTotal: { gt: 0 }, status: { in: ["PAID", "RECEIVED_PENDING_REVIEW", "RECEIVED"] } },
      ],
    },
    select: { groupId: true, shippingCostTotal: true, shippingPaymentRequestedAt: true, paidAt: true },
  });
  if (rows.length === 0) return null;

  const byGroup = new Map<string, { total: number; requestedAt: Date | null }>();
  for (const r of rows) {
    const cur = byGroup.get(r.groupId) ?? { total: 0, requestedAt: r.shippingPaymentRequestedAt ?? r.paidAt };
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

// Pedido del usuario 2026-10-03: quien propone en Análisis de Mercado (hoy
// Jariel) ve en Inicio sus propuestas rechazadas hasta marcar "Enterado"
// (rejectionSeenAt) y, solo informativo, las aprobadas a las que todavía no
// se les hizo ninguna compra (las "listo para comprar" ya tienen su propio
// pendiente, getMarketProductReadyToBuyPendingItem).
async function getMarketProposerPendingItems(userId: string): Promise<PendingItem[]> {
  const href = "/area/workspace?tab=analisis-mercado&ptab=mispropuestas";
  const [rejected, approved] = await Promise.all([
    // Desde 2026-10-03 (updatedAt: también cubre las canceladas después de
    // aprobadas) — las rechazadas antes ya las vio por notificación.
    prisma.marketProductProposal.findMany({
      where: { proposedById: userId, status: "REJECTED", rejectionSeenAt: null, updatedAt: { gte: new Date("2026-10-03T00:00:00-05:00") } },
      select: { code: true, productName: true },
    }),
    prisma.marketProductProposal.findMany({
      where: { proposedById: userId, status: "APPROVED", readyToBuyAt: null, publishedAt: null, catalogItemId: { not: null } },
      select: { code: true, productName: true, catalogItemId: true },
    }),
  ]);
  const items: PendingItem[] = [];
  if (rejected.length > 0) {
    items.push({
      type: "analisis_mercado_rechazadas",
      icon: "📝",
      label: "Propuestas rechazadas — revisa el motivo",
      meta: rejected.length === 1 ? `${rejected[0].code} ${rejected[0].productName}` : `${rejected.length} propuestas`,
      overdue: false,
      href,
    });
  }
  if (approved.length > 0) {
    const withPurchase = new Set(
      (await prisma.purchaseRequest.findMany({ where: { catalogItemId: { in: approved.map((a) => a.catalogItemId!) } }, select: { catalogItemId: true } })).map((p) => p.catalogItemId)
    );
    const noPurchase = approved.filter((a) => !withPurchase.has(a.catalogItemId!));
    if (noPurchase.length > 0) {
      items.push({
        type: "analisis_mercado_aprobadas_sin_compra",
        icon: "✅",
        label: "Propuestas aprobadas — todavía sin compra",
        meta: noPurchase.length === 1 ? `${noPurchase[0].code} ${noPurchase[0].productName}` : `${noPurchase.length} propuestas`,
        overdue: false,
        href,
      });
    }
  }
  return items;
}

// Confirmado 2026-08-17: pedido explícito del usuario — Bryan (o cualquier
// otro delegado de Control de Compras, hoy o en el futuro) quiere ver en
// Inicio, con un solo clic, sus PROPIAS solicitudes de compra que quedaron
// esperando algo de él: rechazada (falta corregir y reenviar), falta
// completar transportista/costo de envío, o admin/Finanzas le pidió cambiar
// la cuenta bancaria del proveedor. Filtra por requestedById (el DATO de
// quién la creó, no un permiso) — así aparece solo para quien de verdad
// tiene algo propio pendiente, sin importar su departamento real (mismo
// espíritu que el resto de "Control de Compras", que ya vive fuera de
// dept.code — ver canSubmitPurchaseRequests).
async function getPurchaseRequesterPendingItems(userId: string, href: string): Promise<PendingItem[]> {
  const rows = await prisma.purchaseRequest.findMany({
    where: { requestedById: userId },
    select: {
      groupId: true,
      status: true,
      shippingCarrierPending: true,
      bankAccountChangeRequestedAt: true,
      requestedAt: true,
      rejectionClosedAt: true,
      supplier: { select: { paymentMode: true } },
    },
  });
  if (rows.length === 0) return [];

  const byGroup = new Map<string, (typeof rows)[number]>();
  for (const r of rows) if (!byGroup.has(r.groupId)) byGroup.set(r.groupId, r);
  const groups = [...byGroup.values()];
  const cutoff = new Date(Date.now() - 24 * 60 * 60 * 1000);
  const items: PendingItem[] = [];

  // Pedido del usuario 2026-10-05: lo que no llegó con el resto del pedido
  // (ver getPurchaseLinesLeftBehind) — a quien compró, para que lo coordine.
  const leftBehind = await getPurchaseLinesLeftBehind(userId);
  if (leftBehind.length > 0) {
    items.push({
      type: "compras_falta_mercaderia",
      icon: "🚨",
      label: "Mercadería que no llegó con el resto del pedido — coordina crédito, devolución o envío con el proveedor",
      meta:
        leftBehind.length === 1
          ? `${leftBehind[0].name} (${leftBehind[0].quantity} un.) · ${leftBehind[0].supplierName}`
          : `${leftBehind.length} productos: ${leftBehind.map((l) => l.name).join(", ")}`,
      overdue: true,
      href: LEFT_BEHIND_HREF,
    });
  }
  const overdueOrders = await getPurchaseLinesOverdue(userId);
  if (overdueOrders.length > 0) {
    items.push({
      type: "compras_pedido_sin_llegar",
      icon: "⏰",
      label: "Pedido que lleva más de 2 días sin llegar — pregunta al proveedor",
      meta:
        overdueOrders.length === 1
          ? `${overdueOrders[0].name} (${overdueOrders[0].quantity} un.) · ${overdueOrders[0].supplierName} · ${overdueOrders[0].days} días`
          : `${overdueOrders.length} productos: ${overdueOrders.map((l) => l.name).join(", ")}`,
      overdue: true,
      href: OVERDUE_ORDERS_HREF,
    });
  }

  // Pedido del usuario 2026-10-03: las que se cerraron con "No se reenvía"
  // (close-rejection) ya no cuentan.
  const rejected = groups.filter((g) => g.status === "REJECTED" && !g.rejectionClosedAt);
  if (rejected.length > 0) {
    items.push({
      type: "compras_rechazadas",
      icon: "🔁",
      label: "Solicitudes de compra rechazadas — corregir y reenviar, o cerrar si no va",
      meta: `${rejected.length} solicitud${rejected.length === 1 ? "" : "es"} · atrasado`,
      overdue: true,
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

  // Confirmado 2026-09-03: pedido de Jariel vía Andrés — ya recibía la
  // notificación puntual de "Tu solicitud ya fue pagada", pero una vez
  // pagada la solicitud desaparecía por completo de su Inicio (el siguiente
  // paso, confirmar la recepción física, es exclusivo de Daniel/Inventario —
  // ver getPurchaseReceivingPendingItem). Esto es puramente informativo
  // (nunca "atrasado", mismo criterio que getMyPersonalPurchaseStatusPendingItem
  // para compras personales) — solo mantiene visible "ya se pagó, sigue en
  // curso" hasta que Inventario la reciba (status pasa a RECEIVED y deja de
  // matchear el filtro).
  // Pedido del usuario 2026-10-03: también las APROBADAS (antes desaparecían
  // de Inicio entre aprobar y pagar). Crédito (CHEN) no pasa por pago.
  const paidTracking = groups.filter((g) => g.status === "APPROVED" || g.status === "PAID" || g.status === "RECEIVED_PENDING_REVIEW");
  if (paidTracking.length > 0) {
    const statusLabel = (g: (typeof groups)[number]) =>
      g.status === "APPROVED"
        ? g.supplier.paymentMode === "CREDITO"
          ? "Aprobada — esperando que llegue la mercadería"
          : "Aprobada — esperando el pago"
        : g.status === "PAID"
          ? "Pagada — esperando que Inventario confirme la recepción"
          : "Inventario ya recibió — falta la aprobación final de Daniel";
    const meta = paidTracking.length === 1 ? statusLabel(paidTracking[0]) : `${paidTracking.length} solicitudes en curso`;
    items.push({
      type: "compras_pago_seguimiento",
      icon: "📦",
      label: "Tu solicitud de compra — seguimiento",
      meta,
      overdue: false,
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
// no por permiso de departamento.
// Extraído a función propia (confirmado 2026-08-27) — además de alimentar la
// tarjeta de Inicio (solo líderes, ver getPendingTasksForActor), la pestaña
// "Registro de Egresos" de "Mi área de trabajo" (DeptWorkspaceTabs /
// MerchandiseOutflowPanel) necesita el mismo conteo para CUALQUIER colaborador,
// no solo líderes, porque /api/merchandise-outflow/supplier-exchange/mine
// (el dueño real de este flujo) tampoco exige liderazgo — así se ve la
// sección "Mis solicitudes de gestión pendiente" ahí aunque no tenga ningún
// otro permiso del módulo.
export async function getSupplierExchangeGestorCount(userId: string): Promise<number> {
  const marketingLeadId = await getMarketingLeadId();
  const or: Record<string, unknown>[] = [{ linkedPurchaseRequest: { requestedById: userId } }];
  if (marketingLeadId === userId) or.push({ linkedPurchaseRequestId: null });

  return prisma.merchandiseOutflowItem.count({
    // Los de un paquete de revisión (deterioro) los resuelve Jariel desde el
    // reclamo de deterioro, no quien compró — ver to-exchange/route.ts.
    where: { batch: { reason: "CAMBIO_PROVEEDOR", submittedAt: { not: null } }, resolution: null, sourceDeteriorItemId: null, OR: or },
  });
}

async function getSupplierExchangeGestorPendingItem(userId: string, href: string): Promise<PendingItem | null> {
  const count = await getSupplierExchangeGestorCount(userId);
  if (count === 0) return null;
  return {
    type: "cambio_proveedor_gestion",
    icon: "🔁",
    label: "Mercadería devuelta al proveedor pendiente de tu gestión",
    meta: `${count} producto${count === 1 ? "" : "s"}`,
    overdue: false,
    href,
  };
}

// Confirmado 2026-09-17, pedido explícito del usuario: reclamos de
// DETERIORO escalados (ver DeteriorResolutionInbox) pendientes de que quien
// gestiona compras (hoy Jariel, vía canManagePurchases) elija el proveedor,
// los ancle a una compra real y registre el resultado — ver purchase-link/
// purchase-resolve. A diferencia de getSupplierExchangeGestorCount (que
// filtra por quién pidió la compra original), acá no hay ese dato de
// antemano — es company-wide, para quien tenga el flag hoy.
export async function getPurchaseGestionPendingCount(): Promise<number> {
  return prisma.merchandiseOutflowItem.count({
    where: {
      resolution: "ESCALATED_TO_PURCHASES",
      purchaseResolution: null,
      OR: [{ purchaseNoMatchReportedAt: null }, { purchaseExceptionDecision: "AUTHORIZED" }],
    },
  });
}

async function getPurchaseGestionPendingItem(href: string): Promise<PendingItem | null> {
  const count = await getPurchaseGestionPendingCount();
  if (count === 0) return null;
  return {
    type: "deterioro_compras_gestion",
    icon: "🔧",
    label: "Deterioro escalado pendiente de gestión con el proveedor",
    meta: `${count} reclamo${count === 1 ? "" : "s"}`,
    overdue: false,
    href,
  };
}

// Confirmado 2026-09-24, reportado por Daniel: los excedentes (llegó más de
// lo pedido, ver urgent-report/route.ts) solo avisaban UNA vez por push/
// campanita en cada paso — si nadie lo veía, quedaban trabados sin que
// nadie supiera (SC-082: 40 un. esperando a Bryan desde el 22/9). Ahora cada
// paso queda en Inicio de quien le toca hasta que lo haga: gestionar con el
// proveedor (Compras) → confirmar (quien aprueba compras) → ingresar al
// Kardex (Daniel).
const EXCESS_STEPS = {
  gestion: {
    type: "compras_excedente_gestion",
    label: "Excedente de mercadería por gestionar con el proveedor",
    where: { excessQty: { gt: 0 }, reviewedByLeadAt: { not: null }, excessGestionAt: null },
  },
  confirmar: {
    type: "compras_excedente_confirmar",
    label: "Excedente de mercadería esperando tu confirmación",
    where: { excessQty: { gt: 0 }, excessGestionAt: { not: null }, excessConfirmedAt: null },
  },
  kardex: {
    type: "compras_excedente_kardex",
    label: "Excedente confirmado — falta ingresarlo al Kardex",
    where: { excessQty: { gt: 0 }, excessConfirmedAt: { not: null }, excessKardexRecordedAt: null },
  },
} as const;

async function getPurchaseExcessPendingItem(step: keyof typeof EXCESS_STEPS, href: string): Promise<PendingItem | null> {
  const cfg = EXCESS_STEPS[step];
  const rows = await prisma.purchaseRequestUrgentReport.findMany({ where: cfg.where, select: { excessQty: true } });
  if (rows.length === 0) return null;
  const units = rows.reduce((s, r) => s + r.excessQty, 0);
  return {
    type: cfg.type,
    icon: "📦",
    label: cfg.label,
    meta: `${rows.length} excedente${rows.length === 1 ? "" : "s"} · ${units} un.`,
    overdue: false,
    href,
  };
}

// Confirmado 2026-09-23, pedido de Jariel (vía el usuario): productos que
// Compras ya no consigue con ningún proveedor (ver SupplierStockoutReport),
// pendientes de que Heidy/Bryan cierren el ID en Dropi o bajen el stock.
// Company-wide, para quien de verdad pueda resolver (ver
// canResolveSupplierStockout en guards.ts).
export async function getSupplierStockoutPendingCount(): Promise<number> {
  return prisma.supplierStockoutReport.count({ where: { resolvedAt: null } });
}

// Confirmado 2026-09-28 — ver catalogMissingDropiId.ts. Para Heidy (canPublishMarketProduct).
async function getCatalogMissingDropiIdPendingItem(href: string): Promise<PendingItem | null> {
  const count = await prisma.purchaseCatalogItem.count({ where: catalogMissingDropiIdWhere });
  if (count === 0) return null;
  return {
    type: "analisis_mercado_sin_id",
    icon: "🏷️",
    label: "Productos de Compras sin ID de Dropi",
    meta: `${count} producto${count === 1 ? "" : "s"}`,
    overdue: false,
    href,
  };
}

// Pedido del usuario 2026-09-30 (Bryan, casco SC-124): productos aprobados en
// Análisis de Mercado que todavía no están en Dropi pero ya se están
// comprando — Heidy los publica primero, antes de que lleguen a bodega.
async function getPurchaseInTransitUnpublishedPendingItem(href: string): Promise<PendingItem | null> {
  const proposals = await prisma.marketProductProposal.findMany({
    where: { status: "APPROVED", publishedAt: null, catalogItemId: { not: null } },
    select: { catalogItemId: true, productName: true },
  });
  const codes = await getOpenPurchaseCodesByCatalogItem(proposals.map((p) => p.catalogItemId!));
  const hits = proposals.filter((p) => codes.has(p.catalogItemId!));
  if (hits.length === 0) return null;
  return {
    type: "analisis_mercado_compra_en_camino",
    icon: "🛒",
    label: "Ya se está comprando — publícalo en Dropi primero",
    meta: hits.length === 1 ? hits[0].productName : `${hits.length} productos`,
    overdue: true,
    href,
  };
}

// Pedido del usuario 2026-10-02 — ver dropiPriceChanges.ts: productos
// publicados cuyo Precio Dropi subió (2%+) o bajó (3%+) desde lo confirmado.
async function getDropiPriceChangesPendingItem(href: string): Promise<PendingItem | null> {
  const changes = await getDropiPriceChanges();
  if (changes.length === 0) return null;
  const up = changes.filter((c) => c.direction === "UP").length;
  const down = changes.length - up;
  const parts = [up ? `${up} mínimo${up === 1 ? "" : "s"} sube${up === 1 ? "" : "n"}` : null, down ? `${down} mínimo${down === 1 ? "" : "s"} baja${down === 1 ? "" : "n"}` : null].filter(Boolean);
  return {
    type: "precio_dropi_cambio",
    icon: "💲",
    label: "Cambió el precio mínimo en Dropi",
    meta: changes.length === 1 ? `${changes[0].name} → $${changes[0].newPrice.toFixed(2)}` : parts.join(" · "),
    // Una subida es urgente: con el precio viejo se gana menos del 20%.
    overdue: up > 0,
    href,
  };
}

// Pedido del usuario 2026-10-03: cada lunes la IA deja la lista de combos de
// la semana (ver comboSuggestions.ts). La asesora B2B la ve con un clic desde
// Inicio; el aviso se va solo cuando ya no quedan combos sin mandar.
async function getWeeklyComboSuggestionsPendingItem(): Promise<PendingItem | null> {
  const count = await prisma.comboSuggestion.count({ where: { status: "SUGERIDO" } });
  if (count === 0) return null;
  return {
    type: "combos_semana",
    icon: "🧩",
    label: "Combos sugeridos de esta semana",
    meta: `${count} combo${count === 1 ? "" : "s"} para elegir cuáles mandar a aprobación`,
    overdue: false,
    href: "/area/workspace?tab=analisis-mercado&otab=combos",
  };
}

// Pedido del usuario 2026-09-30: producto dado de baja que igual se vendió
// en Dropi — Heidy lo da de baja allá (ver lib/dropiDiscontinued.ts).
async function getDropiDiscontinuedPendingItem(): Promise<PendingItem | null> {
  const count = await getDiscontinuedPendingCount();
  if (count === 0) return null;
  return {
    type: "dropi_dado_de_baja",
    icon: "⛔",
    label: "Se vendió en Dropi un producto dado de baja — dalo de baja allá",
    meta: `${count} venta${count === 1 ? "" : "s"}`,
    overdue: true,
    href: DISCONTINUED_URL,
  };
}

// Para Bryan Ríos: la guía ya se generó, gestiona con Dropi que la anulen.
async function getDropiDiscontinuedOrderPendingItem(): Promise<PendingItem | null> {
  const count = await getDiscontinuedOrderPendingCount();
  if (count === 0) return null;
  return {
    type: "dropi_guia_por_anular",
    icon: "⛔",
    label: "Guía de un producto dado de baja — gestiona con Dropi que la anulen",
    meta: `${count} guía${count === 1 ? "" : "s"}`,
    overdue: true,
    href: DISCONTINUED_URL,
  };
}

// Seguimiento de tiendas (2026-10-01): productos de Importadora Shanghai que
// salieron en las guías sin que la etiqueta dijera su tienda — Yair los vincula.
async function getStoreTrackingUnlinkedPendingItem(): Promise<PendingItem | null> {
  const count = await getUnlinkedShanghaiCount();
  if (count === 0) return null;
  return {
    type: "seguimiento_tiendas_sin_tienda",
    icon: "🏬",
    label: "Productos de Shanghai sin tienda — vincúlalos",
    meta: `${count} producto${count === 1 ? "" : "s"}`,
    overdue: false,
    href: "/area/workspace?tab=seguimiento-tiendas",
  };
}

async function getSupplierStockoutPendingItem(href: string): Promise<PendingItem | null> {
  const count = await getSupplierStockoutPendingCount();
  if (count === 0) return null;
  return {
    type: "supplier_stockout_pendiente",
    icon: "🚫",
    label: "Producto sin stock de proveedor pendiente de resolver",
    meta: `${count} producto${count === 1 ? "" : "s"}`,
    overdue: false,
    href,
  };
}

// Confirmado 2026-09-17, pedido explícito del usuario: si quien gestiona no
// encuentra ninguna compra real que respalde un reclamo, nunca se cierra
// solo — pasa a admin como excepción (ver purchase-exception-decide/route.ts).
// Company-wide, exclusivo de admin.
export async function getPurchaseExceptionsPendingCount(): Promise<number> {
  return prisma.merchandiseOutflowItem.count({
    where: { purchaseNoMatchReportedAt: { not: null }, purchaseExceptionDecision: null },
  });
}

async function getPurchaseExceptionAdminPendingItem(href: string): Promise<PendingItem | null> {
  // Confirmado 2026-09-28: misma página suma los reclamos que Jariel pidió
  // cerrar SIN captura con CHEN (esperando que admin los apruebe).
  const [noMatchCount, noProofCount] = await Promise.all([
    getPurchaseExceptionsPendingCount(),
    prisma.merchandiseOutflowItem.count({ where: { noProofRequestedAt: { not: null }, noProofDecidedAt: null, purchaseResolution: null } }),
  ]);
  const count = noMatchCount + noProofCount;
  if (count === 0) return null;
  return {
    type: "deterioro_compras_excepcion",
    icon: "🚨",
    label:
      noMatchCount > 0 && noProofCount > 0
        ? "Reclamos de deterioro esperando tu decisión"
        : noProofCount > 0
          ? "Reclamo sin captura (Chen) por aprobar"
          : "Reclamo de deterioro sin compra que lo respalde",
    meta: `${count} caso${count === 1 ? "" : "s"}`,
    overdue: true,
    href,
  };
}

// Confirmado 2026-09-28: las solicitudes de ajuste de stock por conteo
// físico que deja Daniel (Stock Actual) antes solo se veían como "Pendiente:
// N" en la fila y en la bandeja dorada de esa pestaña — nunca llegaban al
// Inicio del admin, así que quedaban olvidadas. Exclusivo de admin. Cada
// fila se borra al aprobar/rechazar (ver stockKardex.ts), así que contar
// todas = contar las pendientes.
// Confirmado 2026-09-29: corrección de precio de una compra ya aprobada
// (Jariel/Bryan la piden con la captura del acuerdo) — solo el admin decide,
// y mientras espera el pedido no se puede pagar.
async function getPriceCorrectionAdminPendingItem(href: string): Promise<PendingItem | null> {
  const rows = await prisma.purchasePriceCorrection.findMany({
    where: { status: "PENDING" },
    select: { request: { select: { catalogItem: { select: { name: true } } } } },
  });
  if (rows.length === 0) return null;
  const names = [...new Set(rows.map((r) => r.request.catalogItem.name))];
  return {
    type: "correccion_precio_compra",
    icon: "💲",
    label: "Corrección de precio de compra — aprobar o rechazar",
    meta: `${rows.length} pedido${rows.length === 1 ? "" : "s"} · ${names.slice(0, 3).join(", ")}${names.length > 3 ? "…" : ""} · no se paga hasta que decidas`,
    overdue: true,
    href,
  };
}

// Confirmado 2026-09-29 (antifraude): una "Pérdida" que pide Compras en un
// reporte urgente ya no se cierra sola — espera al admin, y mientras tanto
// el pedido no se paga.
async function getWriteOffApprovalAdminPendingItem(href: string): Promise<PendingItem | null> {
  const rows = await prisma.purchaseUrgentResolution.findMany({
    where: { type: "WRITE_OFF", status: "PENDING" },
    select: { amount: true, report: { select: { request: { select: { catalogItem: { select: { name: true } } } } } } },
  });
  if (rows.length === 0) return null;
  const names = [...new Set(rows.map((r) => r.report.request.catalogItem.name))];
  const total = rows.reduce((s, r) => s + r.amount, 0);
  return {
    type: "perdida_compra_aprobar",
    icon: "⚠️",
    label: "Pérdidas en reclamos de compra — aprobar o anular",
    meta: `${rows.length} · $${total.toFixed(2)} · ${names.slice(0, 3).join(", ")}${names.length > 3 ? "…" : ""}`,
    overdue: true,
    href,
  };
}

async function getStockAdjustmentAdminPendingItem(href: string): Promise<PendingItem | null> {
  const count = await prisma.stockPhysicalCountAdjustmentRequest.count();
  if (count === 0) return null;
  return {
    type: "ajuste_stock_conteo",
    icon: "📦",
    label: "Ajuste de stock por conteo físico — aprobar o rechazar",
    meta: `${count} solicitud${count === 1 ? "" : "es"} de Inventario`,
    overdue: true,
    href,
  };
}

// Confirmado 2026-09-28 (revisión de avisos del admin): estas cuatro
// decisiones eran exclusivas del admin pero nunca llegaban a su Inicio —
// solo se veían si entraba justo a la pantalla correcta.
// Borrar un producto del catálogo de compras: la solicitud solo aparecía
// dentro del buscador de "Solicitar" al buscar ese producto, así que el
// aviso nombra los productos para que sepa qué buscar.
async function getPurchaseCatalogDeleteRequestAdminPendingItem(href: string): Promise<PendingItem | null> {
  const rows = await prisma.purchaseCatalogItemDeleteRequest.findMany({
    select: { item: { select: { name: true } } },
    orderBy: { requestedAt: "asc" },
  });
  if (rows.length === 0) return null;
  const names = rows.map((r) => r.item.name);
  return {
    type: "catalogo_compras_borrado",
    icon: "🗑️",
    label: "Piden borrar productos del catálogo de compras",
    meta: `${names.slice(0, 3).join(", ")}${names.length > 3 ? ` y ${names.length - 3} más` : ""} · búscalos en Solicitar`,
    overdue: false,
    href,
  };
}

// Anti-fraude (2026-09-23): una cuenta que agregó otra persona no se puede
// pagar hasta que el admin la verifique con el proveedor.
async function getSupplierBankAccountVerifyAdminPendingItem(href: string): Promise<PendingItem | null> {
  const rows = await prisma.supplierBankAccount.findMany({
    where: { verifiedAt: null },
    select: { supplier: { select: { name: true } } },
  });
  if (rows.length === 0) return null;
  const names = [...new Set(rows.map((r) => r.supplier.name))];
  return {
    type: "cuenta_proveedor_verificar",
    icon: "🏦",
    label: "Cuentas bancarias de proveedores por verificar",
    meta: `${rows.length} cuenta${rows.length === 1 ? "" : "s"} · ${names.slice(0, 3).join(", ")}${names.length > 3 ? "…" : ""}`,
    overdue: true,
    href,
  };
}

// Caja Chica: segundo pago de flete del mismo grupo — no se puede pagar
// hasta que el admin apruebe la excepción.
async function getPettyCashFreightExceptionAdminPendingItem(hrefBase: string): Promise<PendingItem | null> {
  const count = await prisma.pettyCashFreightException.count({ where: { status: "pending" } });
  if (count === 0) return null;
  return {
    type: "caja_chica_excepcion_flete",
    icon: "🚚",
    label: "Caja Chica — excepción de flete por aprobar",
    meta: `${count} solicitud${count === 1 ? "" : "es"}`,
    overdue: true,
    href: `${hrefBase}?tab=cajachica`,
  };
}

// Mismo criterio que nómina/IESS (getPayrollTransferKindPendingItem) para
// la transferencia del sueldo de Nairoby, que también aprueba el admin.
async function getPayrollNairobySalaryTransferPendingItem(forAdmin: boolean, href: string): Promise<PendingItem | null> {
  const rows = await prisma.payrollNairobySalaryTransfer.findMany({
    where: { status: { in: ["PENDING_APPROVAL", "REJECTED"] } },
    include: { period: { select: { period: true } } },
  });
  return getPayrollTransferKindPendingItem({ forAdmin, href, noun: "sueldo de Nairoby", type: "sueldo_nairoby_transferencia", rows });
}

// Confirmado 2026-09-28, pedido del usuario: cuando alguien reporta que un
// producto no está en el catálogo, antes no le salía a nadie en Inicio —
// lo resuelve Daniel (JustCatalogPanel → MissingReportsQueue).
async function getCatalogMissingReportPendingItem(href: string): Promise<PendingItem | null> {
  await autoResolveFoundMissingReports();
  const rows = await prisma.catalogMissingReport.findMany({
    where: { resolvedAt: null },
    select: { query: true },
    orderBy: { reportedAt: "asc" },
  });
  if (rows.length === 0) return null;
  const names = rows.map((r) => `"${r.query}"`);
  return {
    type: "catalogo_producto_faltante",
    icon: "🔎",
    label: "Reportan productos que no están en el catálogo",
    meta: `${names.slice(0, 3).join(", ")}${names.length > 3 ? ` y ${names.length - 3} más` : ""}`,
    overdue: false,
    href,
  };
}

// Confirmado 2026-08-27, pedido explícito del usuario: si un proveedor
// rechaza un cambio (ni cambia el producto ni da crédito), es una pérdida
// real — admin ve un aviso urgente company-wide mientras falte la baja
// financiera de Nairoby (desde 2026-09-23 ya no existe la "baja en Just" de
// Daniel: la mercadería ya salió de INVESTOCK al armar el paquete).
async function getSupplierExchangeRejectedAdminPendingItem(href: string): Promise<PendingItem | null> {
  const rows = await prisma.merchandiseOutflowItem.findMany({
    where: { resolution: "REJECTED", financeWriteOffAt: null },
    select: { expectedCreditAmount: true },
  });
  if (rows.length === 0) return null;
  const atRisk = rows.reduce((s, r) => s + (r.expectedCreditAmount ?? 0), 0);
  return {
    type: "cambio_proveedor_rechazo",
    icon: "⚠️",
    label: "Proveedor rechazó un cambio con mercadería",
    meta: `${rows.length} producto${rows.length === 1 ? "" : "s"}${atRisk > 0 ? ` · $${atRisk.toFixed(2)} en riesgo` : ""} · atrasado`,
    overdue: true,
    href,
  };
}

// Tarea puntual de Nairoby: registrar la pérdida en la parte financiera.
async function getSupplierExchangeFinanceWriteOffPendingItem(href: string): Promise<PendingItem | null> {
  const count = await prisma.merchandiseOutflowItem.count({ where: { resolution: "REJECTED", financeWriteOffAt: null } });
  if (count === 0) return null;
  return {
    type: "cambio_proveedor_rechazo",
    icon: "⚠️",
    label: "Mercadería rechazada por proveedor — dar de baja financiera",
    meta: `${count} producto${count === 1 ? "" : "s"} · atrasado`,
    overdue: true,
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
// Corregido 2026-09-15 — mismo bug real reportado por el usuario que en
// /api/purchase-requests?view=receiving: un proveedor de crédito (hoy CHEN)
// nunca pasa por PAID, se recibe directo desde APPROVED (ver
// receipt/route.ts, isCreditSupplier). Sin la rama de abajo, este pendiente
// de Inicio nunca avisaba a Daniel que una compra de CHEN estaba esperando
// que la reciba — se quedaba invisible mientras seguía "Aprobado" para
// siempre. El "atrasado" para esos casos ahora cuenta desde reviewedAt (la
// aprobación) ya que no hay paidAt que usar.
// Pedido de Jariel 2026-10-05: producto que no se registró con el resto del
// pedido — Inventario confirma al instante si llegó o no (ver
// purchaseLeftBehind.ts). Sin cantidades: el equipo no las ve.
async function getLinesToConfirmPendingItem(): Promise<PendingItem | null> {
  const lines = await getLinesToConfirm();
  if (lines.length === 0) return null;
  return {
    type: "compras_confirmar_no_llego",
    icon: "📦",
    label: "Producto que no se registró con el resto del pedido — confirma si llegó o no",
    meta: lines.length === 1 ? `${lines[0].name} · ${lines[0].supplierName}` : `${lines.length} productos: ${lines.map((l) => l.name).join(", ")}`,
    overdue: true,
    href: INVENTORY_RECEIVING_HREF,
  };
}

// Corregido 2026-09-26, pedido del usuario: el equipo de Inventario veía el
// monto ("$1680.00") en Inicio — mismo criterio de 2026-08-18 que
// PurchaseReceivingPanel: valores económicos solo para Daniel (líder) y admin.
async function getPurchaseReceivingPendingItem(href: string, showAmount: boolean): Promise<PendingItem | null> {
  const rows = await prisma.purchaseRequest.findMany({
    where: {
      OR: [
        { status: { in: ["PAID", "RECEIVED_PENDING_REVIEW"] } },
        { status: "APPROVED", supplier: { paymentMode: "CREDITO" } },
      ],
    },
    select: { groupId: true, totalCost: true, paidAt: true, reviewedAt: true, receipt: { select: { confirmedAt: true } } },
  });
  if (rows.length === 0) return null;

  const byGroup = new Map<string, { total: number; at: Date | null }>();
  for (const r of rows) {
    const at = r.receipt?.confirmedAt ?? r.paidAt ?? r.reviewedAt;
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
    meta: `${groups.length} solicitud${groups.length === 1 ? "" : "es"}${showAmount ? ` · $${total.toFixed(2)}` : ""}${overdue ? " · atrasado" : ""}`,
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
    label: "Verificar mercadería del proveedor pendiente",
    meta: `${rows.length} pendiente${rows.length === 1 ? "" : "s"}${overdue ? " · atrasado" : ""}`,
    overdue,
    href,
  };
}

// Confirmado 2026-09-01: pedido explícito del usuario — Daniel (y su equipo)
// ahora ven en solo lectura la pestaña "Reportes urgentes" (antes exclusiva
// de quien coordina con el proveedor), pero no tenían ningún aviso de que un
// reclamo de su propio equipo sigue sin que Compras coordine nada. Mismo
// criterio de "visible en esa pestaña" que usa api/purchase-requests/
// urgent-reports/route.ts (ya revisado por Daniel; nunca rechazado), y misma cuenta de "lo faltante"
// que openReports en PurchaseUrgentReportsPanel.tsx (lo reclamado en
// resoluciones no CANCELLED todavía no cubre lo reportado).
// Pedido del usuario 2026-10-05 (caso bolsas de Megadescuentos): faltantes
// que llegaron cortos y nunca se reclamaron. Quien coordina con el proveedor
// (canManagePurchases) los ve todos y abre el reclamo; quien compró
// (requestedById) los ve en seguimiento.
async function getShortReceiptsUnclaimedPendingItem(href: string, requestedById?: string): Promise<PendingItem | null> {
  const rows = await getShortReceiptsUnclaimed(requestedById);
  if (rows.length === 0) return null;
  return {
    type: "compras_faltante_sin_reclamar",
    icon: "🚨",
    label: requestedById
      ? "Faltante de tu compra que nunca se reclamó al proveedor (seguimiento)"
      : "Faltante que nunca se reclamó al proveedor — abre el reclamo",
    meta:
      rows.length === 1
        ? `${rows[0].name} · faltan ${rows[0].missing} de ${rows[0].quantity} un. · ${rows[0].supplierName}`
        : `${rows.length} productos: ${rows.map((r) => r.name).join(", ")}`,
    overdue: true,
    href,
  };
}

// Pedido del usuario 2026-10-05: `opts.label` para quien coordina con el
// proveedor (Jariel) y `opts.requestedById` para que quien aprueba compras
// (Bryan) vea, en seguimiento, los reclamos de las compras que él hizo.
async function getPurchaseUrgentReportsUnresolvedPendingItem(
  href: string,
  opts: { label?: string; requestedById?: string } = {}
): Promise<PendingItem | null> {
  const rows = await prisma.purchaseRequestUrgentReport.findMany({
    where: {
      rejectedAt: null,
      reviewedByLeadAt: { not: null },
      ...(opts.requestedById ? { request: { requestedById: opts.requestedById } } : {}),
    },
    select: {
      damagedQty: true,
      missingQty: true,
      incompleteQty: true,
      differentQty: true,
      reportedAt: true,
      resolutions: { select: { quantity: true, status: true } },
    },
  });
  const open = rows.filter((r) => {
    const total = r.damagedQty + r.missingQty + r.incompleteQty + r.differentQty;
    const claimed = r.resolutions.filter((res) => res.status !== "CANCELLED").reduce((s, res) => s + res.quantity, 0);
    return claimed < total;
  });
  if (open.length === 0) return null;
  const cutoff = new Date(Date.now() - 24 * 60 * 60 * 1000);
  const overdue = open.some((r) => r.reportedAt < cutoff);
  return {
    type: "compras_urgentes_sin_resolver",
    icon: "📦",
    label: opts.label ?? "Reclamos de tu equipo sin resolver con el proveedor",
    meta: `${open.length} reclamo${open.length === 1 ? "" : "s"}${overdue ? " · atrasado" : ""}`,
    overdue,
    href,
  };
}

// Confirmado 2026-08-25: "Reclamo posterior al cierre" — daño descubierto
// DÍAS después de confirmar recibido. Cola propia de Daniel, mismo
// patrón que getPurchaseReceivingPendingItem: reclamos que su equipo subió
// y todavía no revisó (al aprobar, las unidades salen solas de INVESTOCK).
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

// Confirmado 2026-09-16: pedido explícito del usuario — la campanita avisa
// en el momento en que Compras sube un comprobante que sí coincide, pero si
// ese día no la revisa se pierde entre el resto de avisos. Este ítem se
// queda fijo en "Pendientes de esta semana" (mismo criterio que "Créditos
// pendientes de recuperar" arriba) mientras el reembolso siga esperando que
// el admin confirme en su banco — solo admin puede confirmar (ver isAdmin
// en confirm-bank/route.ts), así que este ítem solo aplica a esa sección.
async function getPurchaseRefundBankConfirmPendingItem(href: string): Promise<PendingItem | null> {
  const rows = await prisma.purchaseUrgentResolution.findMany({
    where: { type: "REFUND", status: "PENDING", refundAiMatch: true },
    select: { amount: true, createdAt: true },
  });
  if (rows.length === 0) return null;

  const cutoff = new Date(Date.now() - 24 * 60 * 60 * 1000);
  const overdue = rows.some((r) => r.createdAt < cutoff);
  const total = rows.reduce((s, r) => s + r.amount, 0);
  return {
    type: "compras_reembolsos_por_confirmar",
    icon: "🏦",
    label: "Reembolsos esperando que confirmes tu banco",
    meta: `${rows.length} reembolso${rows.length === 1 ? "" : "s"} · $${total.toFixed(2)}${overdue ? " · atrasado" : ""}`,
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

function payrollDestinationLabel(destination: "NAIROBY" | "ADMIN_PRODUBANCO" | "ADMIN_COMPANY" | "COMPANY_DIRECT"): string {
  if (destination === "NAIROBY") return "cuenta de Nairoby";
  if (destination === "ADMIN_PRODUBANCO") return "tu cuenta Produbanco";
  if (destination === "COMPANY_DIRECT") return "pagar directo desde la cuenta Pichincha";
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
  rows: { status: string; totalAmount: number; destination: "NAIROBY" | "ADMIN_PRODUBANCO" | "ADMIN_COMPANY" | "COMPANY_DIRECT"; period: { period: string } }[];
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
        : t.destination === "COMPANY_DIRECT"
          ? `Aprobar ${noun} — ${acctLabel}`
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

// Confirmado 2026-09-11: pedido explícito del usuario — mensajes sin leer en
// SU PROPIO hilo de Roles de pago (los que le escribió Nómina) visibles en
// Inicio con un clic directo al chat, además del push instantáneo que ya
// dispara notifyOwner en POST /api/payroll-messages/[employeeId]. Aplica a
// cualquier colaborador — cada quien tiene un único hilo, el suyo.
async function getMyPayrollMessageUnreadPendingItem(userId: string, href: string): Promise<PendingItem | null> {
  const rows = await prisma.payrollMessage.findMany({
    where: { employeeId: userId, senderId: { not: userId }, readAt: null },
    select: { createdAt: true },
  });
  if (rows.length === 0) return null;

  const oldest = rows.reduce((min, r) => (r.createdAt < min ? r.createdAt : min), rows[0].createdAt);
  const overdue = Date.now() - oldest.getTime() > 24 * 60 * 60 * 1000;
  return {
    type: "mensajes_nomina_sin_leer",
    icon: "💬",
    label: rows.length === 1 ? "Tienes un mensaje nuevo de Nómina" : `Tienes ${rows.length} mensajes nuevos de Nómina`,
    meta: `Toca para leer y responder${overdue ? " · atrasado" : ""}`,
    overdue,
    href,
  };
}

// Misma idea pero del otro lado: mensajes que colaboradores le escribieron a
// quien gestiona la nómina (líder de Finanzas) y siguen sin leer. Se enlaza
// directo al hilo más antiguo sin responder (mismos query params que usa el
// deep-link del push, ver notifyOwner en la ruta POST).
async function getPayrollMessagesUnreadForManagerPendingItem(baseHref: string): Promise<PendingItem | null> {
  const unread = await prisma.payrollMessage.findMany({
    where: { readAt: null },
    select: { employeeId: true, senderId: true, createdAt: true, employee: { select: { deptId: true } } },
  });
  const fromEmployees = unread.filter((m) => m.senderId === m.employeeId);
  if (fromEmployees.length === 0) return null;

  const perEmployee = new Map<string, { count: number; oldest: Date; deptId: string | null }>();
  for (const m of fromEmployees) {
    const entry = perEmployee.get(m.employeeId);
    if (entry) {
      entry.count += 1;
      if (m.createdAt < entry.oldest) entry.oldest = m.createdAt;
    } else {
      perEmployee.set(m.employeeId, { count: 1, oldest: m.createdAt, deptId: m.employee.deptId });
    }
  }

  let oldestEmployeeId = "";
  let oldestDate: Date | null = null;
  let oldestDeptId: string | null = null;
  for (const [id, v] of perEmployee) {
    if (!oldestDate || v.oldest < oldestDate) {
      oldestDate = v.oldest;
      oldestEmployeeId = id;
      oldestDeptId = v.deptId;
    }
  }

  const overdue = !!oldestDate && Date.now() - oldestDate.getTime() > 24 * 60 * 60 * 1000;
  const employeesCount = perEmployee.size;
  return {
    type: "mensajes_nomina_sin_leer_lider",
    icon: "💬",
    label: employeesCount === 1 ? "Tienes un mensaje sin leer" : `Tienes mensajes sin leer de ${employeesCount} personas`,
    meta: `${fromEmployees.length} mensaje${fromEmployees.length === 1 ? "" : "s"} · toca para responder${overdue ? " · atrasado" : ""}`,
    overdue,
    href: `${baseHref}?employee=${oldestEmployeeId}${oldestDeptId ? `&dept=${oldestDeptId}` : ""}`,
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

// Confirmado 2026-09-26: bug real — cuando Yair envía un corte a Inventario
// (sendLotToInventory) Daniel solo recibía un aviso puntual; si no lo abría,
// en Inicio no le quedaba nada. Sigue apareciendo mientras el corte esté
// SENT (enviado y todavía no confirmado por Daniel).
// 2026-09-26 (pedido del usuario): una fila POR CORTE. Ese mismo día Daniel
// pidió que imprimir sea opcional (se saca desde el celular): el clic lleva
// siempre al corte, donde asigna los bloques y confirma lo que salió.
async function getFulfillmentLotSentPendingItems(href: string): Promise<PendingItem[]> {
  const rows = await prisma.fulfillmentLot.findMany({
    where: { status: "SENT" },
    select: { id: true, day: true, corte: true, sentAt: true, createdAt: true },
    orderBy: [{ day: "asc" }, { corte: "asc" }],
  });
  const cutoff = new Date(Date.now() - 24 * 60 * 60 * 1000);
  // Pedido del usuario 2026-10-01: del 28/09 al 01/10 el equipo contó 21
  // cortes y ninguno se confirmó, así que el stock nunca bajó. La fila ahora
  // dice cuánto falta contar o, si ya está todo contado, que solo falta la
  // confirmación de Daniel (que sigue siendo suya) — atrasado a las 3 horas.
  const readyCutoff = new Date(Date.now() - 3 * 60 * 60 * 1000);
  const progress = new Map<string, { total: number; counted: number; matching: number; lastPickedAt: Date | null; pieces: number }>();
  await Promise.all(
    rows
      .filter((r) => !isBackfillLot(r))
      .map(async (r) => {
        const lot = await getCompiledLot(r.id);
        if (!lot) return;
        const open = lot.picking.filter((p) => !p.confirmedAt);
        const times = open.map((p) => p.pickedAt).filter((t): t is Date => !!t);
        progress.set(r.id, {
          total: open.length,
          counted: open.filter((p) => p.picked !== null).length,
          matching: open.filter((p) => p.picked === p.needed).length,
          lastPickedAt: times.length ? new Date(Math.max(...times.map((t) => new Date(t).getTime()))) : null,
          // Garantías de solo una pieza que Daniel todavía no confirma.
          pieces: lot.warranty.filter((w) => w.mode === "PIECE" && !w.pieceConfirmedAt).length,
        });
      }),
  );
  // Pedido del usuario 2026-10-01: Daniel tenía 13 filas de cortes y se
  // perdían entre lo demás. Ahora una sola fila roja con todos los cortes ya
  // contados (arriba de todo, aviso obligatorio) y una sola con los que
  // faltan contar. Los manifiestos atrasados siguen uno por uno (son pocos).
  const items: PendingItem[] = [];
  const counted: { where: string; matching: number; off: number; late: boolean; day: string }[] = [];
  const toPick: { where: string; counted: number; total: number; overdue: boolean; pieces: number }[] = [];
  for (const r of rows) {
    const [, m, d] = r.day.split("-");
    const overdue = (r.sentAt ?? new Date()) < cutoff;
    const where = `Corte ${r.corte} del ${d}/${m}`;
    // Manifiesto atrasado (2026-09-29): ya salió, solo falta confirmarlo.
    if (isBackfillLot(r)) {
      items.push({
        type: "fulfillment_corte_enviado",
        icon: "🚚",
        label: "Manifiesto atrasado por confirmar",
        meta: `${where} · ya salió, confirma de una vez para descontarlo del stock${overdue ? " · atrasado" : ""}`,
        overdue,
        href,
      });
      continue;
    }
    const p = progress.get(r.id);
    if (p && p.total > 0 && p.counted === p.total) {
      counted.push({ where, matching: p.matching, off: p.total - p.matching, late: overdue || (!!p.lastPickedAt && p.lastPickedAt < readyCutoff), day: `${d}/${m}` });
    } else {
      toPick.push({ where, counted: p?.counted ?? 0, total: p?.total ?? 0, overdue, pieces: p?.pieces ?? 0 });
    }
  }
  if (counted.length > 0) {
    const matching = counted.reduce((s, c) => s + c.matching, 0);
    const off = counted.reduce((s, c) => s + c.off, 0);
    items.unshift({
      type: "fulfillment_cortes_sin_confirmar",
      icon: "🛑",
      label: `${counted.length} corte${counted.length === 1 ? "" : "s"} contado${counted.length === 1 ? "" : "s"} sin confirmar — stock desactualizado desde el ${counted[0].day}`,
      meta: `${matching} cuadran (confírmalos de un clic)${off > 0 ? ` · ${off} no cuadran` : ""} · mientras no confirmes, no baja del stock`,
      overdue: true,
      href,
    });
  }
  if (toPick.length > 0) {
    const late = toPick.some((t) => t.overdue);
    items.push({
      type: "fulfillment_corte_enviado",
      icon: "🚚",
      label: toPick.length === 1 ? "Corte por despachar" : `${toPick.length} cortes por despachar`,
      meta: `${toPick.map((t) => `${t.where}${t.total > 0 ? ` (${t.counted}/${t.total})` : t.pieces > 0 ? ` (solo falta confirmar ${t.pieces} garantía${t.pieces === 1 ? "" : "s"} de pieza)` : ""}`).join(" · ")} · asigna los bloques y confirma lo que salió${late ? " · atrasado" : ""}`,
      overdue: late,
      href,
    });
  }
  return items;
}

// Confirmado 2026-09-26: pedido del usuario — quien tiene un bloque del
// corte asignado por Daniel (ver FulfillmentLotBlock) llega con un clic desde
// Inicio a lo que tiene que sacar de bodega. Antes solo tenía el aviso único
// de la campana. Desaparece cuando registró todo lo de su bloque o Daniel
// cierra el corte.
// Garantías locales (pedido del usuario 2026-10-02): lo que el motorizado
// tiene que traer a bodega y nadie de Inventario confirmó todavía.
async function getLocalWarrantyPickupPendingItem(href: string): Promise<PendingItem | null> {
  const rows = await prisma.externalSale.findMany({
    where: { kind: "WARRANTY", deletedAt: null, deliveredAt: { not: null }, returnedAt: null, items: { some: { warrantyRole: "PICKUP", pickupReceivedAt: null } } },
    select: { code: true, deliveredAt: true },
  });
  if (rows.length === 0) return null;
  const cutoff = new Date(Date.now() - 24 * 60 * 60 * 1000);
  const overdue = rows.some((r) => r.deliveredAt! < cutoff);
  return {
    type: "garantia_local_recogida",
    icon: "🛡️",
    label: "Garantía local — confirma lo que trajo el motorizado",
    meta: `${rows.length === 1 ? rows[0].code : `${rows.length} garantías`}${overdue ? " · atrasado" : ""}`,
    overdue,
    href,
  };
}

// Pedido del usuario 2026-10-02: el primer día de trabajo después de un
// domingo o feriado (calendario automático de Ecuador), quien sube los
// manifiestos ve este recordatorio hasta que suba el primero del día — los
// manifiestos de esos días vencen hoy.
async function getManifestCatchUpPendingItem(href: string): Promise<PendingItem | null> {
  const today = ecuadorDay(new Date());
  const yesterday = new Date(new Date(`${today}T12:00:00Z`).getTime() - 86_400_000).toISOString().slice(0, 10);
  if (!isWorkingDay(today) || isWorkingDay(yesterday)) return null;
  const startOfToday = new Date(`${today}T05:00:00.000Z`); // 00:00 en Ecuador
  const uploaded = await prisma.fulfillmentRequestBatch.count({ where: { requestedAt: { gte: startOfToday } } });
  if (uploaded > 0) return null;
  const from = previousWorkingDay(today);
  const fmt = (d: string) => d.split("-").reverse().slice(0, 2).join("/");
  const holiday = holidayName(yesterday);
  return {
    type: "manifiestos_tras_feriado",
    icon: "📄",
    label: "Sube los manifiestos que quedaron pendientes",
    meta: `Desde el ${fmt(from)}${holiday ? ` (feriado: ${holiday})` : ""} — vencen hoy, súbelos antes del primer corte`,
    overdue: false,
    href,
  };
}

// Conteo físico (pedido del usuario 2026-10-02; por áreas asignadas desde
// 2026-10-05). A quien Daniel asignó un área le sale SU área; a Daniel, qué
// área asignar después, quién va atrasado y cuándo ya puede enviarlo.
function hourEc(iso: string): string {
  return new Date(iso).toLocaleTimeString("es-EC", { hour: "numeric", minute: "2-digit", timeZone: "America/Guayaquil" });
}

function myCountItem(mine: AssignmentView): PendingItem {
  const what = mine.area === "RECOUNT" ? `Recontar ${mine.total} producto(s)` : `Contar ${mine.label}`;
  return {
    type: "conteo_inventario",
    icon: "📋",
    label: mine.startedAt ? `${what}: sigue contando` : `Te toca: ${what} — pulsa «Empezar» cuando termines el corte`,
    meta: `Contados ${mine.done} de ${mine.total} · meta antes de las ${hourEc(mine.deadline)}${mine.late ? " · atrasado" : ""}`,
    overdue: mine.late,
    href: "/area/conteo-inventario",
  };
}

async function getStockCountPendingItems(forLead: boolean, userId: string | null): Promise<PendingItem[]> {
  const count = await getActiveCount(null).catch(() => null);
  // Antes del conteo general, a Daniel le sale el acceso para iniciarlo.
  if (!count && forLead && !(await fullCountCompleted())) {
    return [{
      type: "conteo_inventario",
      icon: "📋",
      label: "Conteo general de inventario — inícialo cuando la bodega esté lista",
      meta: "Antes, confirma todos los cortes pendientes. Luego asignas cada área a una persona.",
      overdue: false,
      href: "/area/conteo-inventario",
    }];
  }
  if (!count || count.status === "APPROVED") return [];
  if (forLead) await notifyLateAssignments().catch(() => null);
  const board = await getAssignmentBoard(count, userId, forLead);
  const items: PendingItem[] = board.mine ? [myCountItem(board.mine)] : [];
  if (!forLead) return items;

  const title = count.kind === "FULL" ? "Conteo general" : `Conteo semanal · Área ${count.area}`;
  const late = [...board.areas.map((a) => a.assignment), ...board.recounts].filter((a): a is AssignmentView => !!a && a.late);
  if (board.unassignedRecount > 0) {
    items.push({ type: "conteo_inventario", icon: "🔁", label: `${board.unassignedRecount} producto(s) para recontar — asígnalos a otra persona`, meta: "El administrador los desmarcó. No puede recontarlos quien los contó.", overdue: true, href: "/area/conteo-inventario" });
  }
  if (count.status !== "COUNTING") return items;
  const finished = board.areas.filter((a) => a.assignment?.finishedAt).length;
  const inProgress = board.areas.filter((a) => a.assignment && !a.assignment.finishedAt);
  const free = board.areas.filter((a) => !a.assignment && a.total > 0);
  const all = board.areas.every((a) => a.total === 0 || a.assignment?.finishedAt);
  // El semanal se atrasa desde el jueves de esa semana.
  const weekLate = count.kind === "WEEKLY_AREA" && !!count.weekStart && ecuadorDay(new Date()) >= new Date(new Date(`${count.weekStart}T12:00:00Z`).getTime() + 3 * 86_400_000).toISOString().slice(0, 10);
  const label = all
    ? `${title}: todas las áreas contadas — revísalo y envíalo`
    : free.length > 0
      ? `${title}: asigna ${free.length === 1 ? free[0].label : `la siguiente área (faltan ${free.map((a) => a.area === "NONE" ? "Sin área" : a.area).join(", ")})`}`
      : `${title}: tu equipo está contando`;
  const meta = [
    `${finished} de ${board.areas.length} área(s) terminadas`,
    ...inProgress.map((a) => `${a.label}: ${a.assignment!.assigneeName} ${a.assignment!.done}/${a.assignment!.total}${a.assignment!.late ? " ⏰" : ""}`),
  ].join(" · ");
  items.push({ type: "conteo_inventario", icon: "📋", label, meta: meta + (late.length || weekLate ? " · atrasado" : ""), overdue: late.length > 0 || weekLate || (free.length > 0 && inProgress.length === 0), href: "/area/conteo-inventario" });
  return items;
}

// Al admin: conteos que Daniel envió con diferencias por aprobar.
async function getStockCountApprovalPendingItem(href: string): Promise<PendingItem | null> {
  const counts = await getSubmittedCounts();
  if (counts.length === 0) return null;
  const diffs = (await Promise.all(counts.map((c) => getDifferences(c.id)))).reduce((sum, d) => sum + d.length, 0);
  // Mientras solo quede lo que se está recontando, no hay nada que aprobar.
  if (diffs === 0) return null;
  return {
    type: "conteo_inventario_aprobar",
    icon: "📋",
    label: "Conteo físico por aprobar — revisa la lista de diferencias",
    meta: `${diffs} producto(s) con diferencia · se aprueban juntos`,
    overdue: true,
    href,
  };
}

// A Daniel, solo después del conteo general (pedido del usuario 2026-10-02):
// un producto en negativo siempre es algo que salió sin registrarse.
async function getNegativeStockPendingItem(href: string): Promise<PendingItem | null> {
  if (!(await fullCountCompleted())) return null;
  const negative = await getNegativeStockProducts();
  if (negative.length === 0) return null;
  return {
    type: "stock_negativo",
    icon: "⚠️",
    label: `${negative.length} producto(s) con stock negativo — algo salió sin registrarse`,
    meta: negative.slice(0, 3).map((n) => `${n.name} (${n.balance})`).join(" · ") + (negative.length > 3 ? " …" : ""),
    overdue: true,
    href,
  };
}

// Al asesor: garantías que ya salieron con el motorizado y todavía no
// confirma si se entregaron (sin eso no se paga el flete).
async function getMyLocalWarrantyPendingItems(userId: string, href: string): Promise<PendingItem[]> {
  const rows = await prisma.externalSale.findMany({
    where: { kind: "WARRANTY", advisorId: userId, deletedAt: null, deliveredAt: { not: null }, clientReceivedAt: null, returnedAt: null },
    select: { code: true, deliveredAt: true, items: { select: { warrantyRole: true, pickupReceivedAt: true } } },
  });
  const cutoff = new Date(Date.now() - 24 * 60 * 60 * 1000);
  return rows.map((r) => {
    const waitingPickup = r.items.some((i) => i.warrantyRole === "PICKUP" && !i.pickupReceivedAt);
    const overdue = r.deliveredAt! < cutoff;
    return {
      type: "garantia_local_resultado",
      icon: "🛡️",
      label: `Garantía ${r.code}: confirma si se entregó`,
      meta: `${waitingPickup ? "Bodega aún no confirma lo que trajo el motorizado" : "Ya salió con el motorizado"}${overdue ? " · atrasado" : ""}`,
      overdue,
      href,
    };
  });
}

async function getMyFulfillmentBlockPendingItems(userId: string, href: string): Promise<PendingItem[]> {
  const lots = await prisma.fulfillmentLot.findMany({
    where: { status: "SENT", blocks: { some: { assigneeId: userId } } },
    select: { id: true },
    orderBy: [{ day: "asc" }, { corte: "asc" }],
  });
  const items: PendingItem[] = [];
  const cutoff = new Date(Date.now() - 24 * 60 * 60 * 1000);
  for (const { id } of lots) {
    const lot = await getCompiledLot(id);
    if (!lot) continue;
    const mine = new Set(lot.blocks.filter((b) => b.assigneeId === userId).map((b) => b.carrier));
    const rows = lot.picking.filter((p) => mine.has(p.block));
    const left = rows.filter((p) => p.picked === null && !p.confirmedAt).length;
    if (left === 0) continue;
    const [, m, d] = lot.day.split("-");
    const overdue = !!lot.sentAt && new Date(lot.sentAt) < cutoff;
    items.push({
      type: "fulfillment_bloque_asignado",
      icon: "📦",
      label: "Mercadería por sacar de bodega",
      meta: `Corte ${lot.corte} del ${d}/${m} · ${[...mine].map(carrierLabel).join(", ")} · faltan ${left} de ${rows.length} productos${overdue ? " · atrasado" : ""}`,
      overdue,
      href,
    });
  }
  return items;
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

// Confirmado 2026-09-09: pedido explícito de Daniel — el reporte de un
// producto encontrado dañado en bodega (no una devolución) le avisa solo con
// notifyOwner puntual (ver deterioro/route.ts), pero mientras Daniel no
// decide (solucionado / dar de baja / escalar a Compras) no queda nada
// recordándoselo en Inicio.
async function getDeteriorResolutionPendingItem(href: string): Promise<PendingItem | null> {
  const rows = await prisma.merchandiseOutflowItem.findMany({
    where: { batch: { reason: "DETERIORO" }, resolution: null },
    select: { batch: { select: { createdAt: true } } },
  });
  if (rows.length === 0) return null;

  const cutoff = new Date(Date.now() - 24 * 60 * 60 * 1000);
  const overdue = rows.some((r) => r.batch.createdAt < cutoff);
  return {
    type: "egresos_deterioro_resolucion",
    icon: "⚠️",
    label: "Deterioro en bodega — falta tu decisión",
    meta: `${rows.length === 1 ? "1 producto" : `${rows.length} productos`}${overdue ? " · atrasado" : ""}`,
    overdue,
    href,
  };
}

// Confirmado 2026-10-01, pedido del usuario: los lotes ya vencidos y los que
// vencen en 6 meses o menos solo se veían entrando a "Lotes de caducidad"
// (o arriba de Stock Actual) — nada en Inicio le recordaba a Daniel que
// tenía algo por gestionar. Solo Daniel (líder de INV), ambos grupos; mismo
// criterio exacto que /api/purchase-catalog/expiration-alerts. Se quita
// solo cuando ya no queda ningún lote con unidades en esa situación.
async function getExpirationLotsPendingItem(href: string): Promise<PendingItem | null> {
  const cutoff = new Date();
  cutoff.setMonth(cutoff.getMonth() + 6);
  const lots = await prisma.expirationCohort.findMany({
    where: { quantityRemaining: { gt: 0 }, expirationDate: { lte: cutoff } },
    select: { expirationDate: true },
  });
  if (lots.length === 0) return null;

  // Fecha de calendario guardada a medianoche UTC (ver ExpirationAlerts):
  // vencido = la fecha ya pasó; hoy todavía cuenta como "por vencer".
  const now = new Date();
  const today = Date.UTC(now.getFullYear(), now.getMonth(), now.getDate());
  const expired = lots.filter((l) => {
    const d = l.expirationDate;
    return Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()) < today;
  }).length;
  const soon = lots.length - expired;

  const parts: string[] = [];
  if (expired > 0) parts.push(`${expired} ${expired === 1 ? "vencido" : "vencidos"}`);
  if (soon > 0) parts.push(`${soon} ${soon === 1 ? "vence" : "vencen"} en 6 meses o menos`);
  return {
    type: "lotes_caducidad_alerta",
    icon: expired > 0 ? "⛔" : "⏳",
    label: expired > 0 ? "Productos vencidos en bodega" : "Productos por vencer",
    meta: parts.join(" · "),
    overdue: expired > 0,
    href,
  };
}

// Pedido del usuario 2026-10-02: la marca se pone sola (al crear el producto,
// o el combo la aprende de su manifiesto — lib/manifestBrand.ts), pero si
// algún ID queda sin marca o un producto sin ID de Dropi, Daniel lo ve en
// Inicio y se lo dice al admin, que es quien lo corrige. No cuenta lo que es
// normal: productos "esperando ID de Dropi" (comprados antes de publicar) ni
// combos solo de Rocket (código R…, no tienen marca a propósito).
async function getMissingBrandPendingItem(href: string): Promise<PendingItem | null> {
  const [products, combos] = await Promise.all([
    prisma.purchaseCatalogItem.findMany({
      where: { OR: [{ bodega: null }, { justCode: null, awaitingDropiId: false }] },
      select: { name: true, justCode: true },
    }),
    prisma.dropiCombo.findMany({ where: { bodega: null, NOT: { code: { startsWith: "R" } } }, select: { code: true } }),
  ]);
  if (products.length === 0 && combos.length === 0) return null;

  const codes = [...products.map((p) => p.justCode ?? p.name), ...combos.map((c) => c.code)];
  const parts: string[] = [];
  if (products.length > 0) parts.push(products.length === 1 ? "1 producto" : `${products.length} productos`);
  if (combos.length > 0) parts.push(combos.length === 1 ? "1 combo" : `${combos.length} combos`);
  return {
    type: "ids_sin_marca",
    icon: "🏷️",
    label: "IDs sin marca — avísale al admin para corregirlo",
    meta: `${parts.join(" · ")}: ${codes.slice(0, 5).join(", ")}${codes.length > 5 ? "…" : ""}`,
    overdue: false,
    href,
  };
}

// Pedido del usuario 2026-10-02: los productos sin área de bodega (A…G) solo
// se veían como "N sin área todavía" dentro de Stock Actual. Ahora Daniel
// los ve en Inicio y con un clic llega a Stock Actual con el filtro "Sin
// área" ya puesto. Mismo criterio que sinAreaCount (todo el catálogo); se
// quita solo cuando ya no queda ninguno, y vuelve si entra uno nuevo.
async function getMissingWarehouseAreaPendingItem(href: string): Promise<PendingItem | null> {
  const products = await prisma.purchaseCatalogItem.findMany({
    where: { warehouseArea: null },
    select: { name: true, justCode: true },
    orderBy: { name: "asc" },
  });
  if (products.length === 0) return null;

  const codes = products.map((p) => p.justCode ?? p.name);
  return {
    type: "productos_sin_area",
    icon: "📍",
    label: "Productos sin área de bodega — asígnales A…G",
    meta: `${products.length === 1 ? "1 producto" : `${products.length} productos`}: ${codes.slice(0, 5).join(", ")}${codes.length > 5 ? "…" : ""}`,
    overdue: false,
    href,
  };
}

// Confirmado 2026-09-28, pedido de Jariel: el proveedor quiere revisar la
// mercadería antes de decidir — Daniel tiene que armar el paquete de
// revisión; y si tras revisarla la rechaza y la devuelve, confirmar que
// regresó a bodega.
async function getDeteriorInspectionPendingItem(href: string): Promise<PendingItem | null> {
  const [toSend, toReceive] = await Promise.all([
    prisma.merchandiseOutflowItem.count({
      where: {
        supplierInspectionRequestedAt: { not: null },
        purchaseResolution: null,
        OR: [{ exchangeItem: { is: null } }, { exchangeItem: { batch: { submittedAt: null } } }],
      },
    }),
    prisma.merchandiseOutflowItem.count({
      where: { purchaseResolution: "REJECTED", inspectionReturnsToWarehouse: true, inspectionReturnReceivedAt: null },
    }),
  ]);
  if (toSend + toReceive === 0) return null;
  return {
    type: "egresos_deterioro_revision_proveedor",
    icon: "📦",
    label: toSend > 0 ? "Enviar mercadería para revisión del proveedor" : "Confirmar mercadería que regresa del proveedor",
    meta: [toSend > 0 ? `${toSend} por enviar` : null, toReceive > 0 ? `${toReceive} por regresar` : null].filter(Boolean).join(" · "),
    overdue: false,
    href,
  };
}

// Bug real reportado 2026-09-21 (Bryan Rios): cuando un asesor (ej. Marcos)
// declara una venta externa nueva, notifyMarketingLeadNewExternalSale le
// manda a Bryan un push/campanita puntual, pero nunca quedaba un acceso en
// la tarjeta "Pendientes de esta semana" de Inicio — a diferencia de
// getExternalSaleDispatchPendingItem (su contraparte para Daniel), esta
// bandeja de revisión no tenía generador. Si Bryan pierde ese aviso puntual
// (o tiene el push apagado), la venta nunca vuelve a aparecerle en ningún
// lado. Mismo criterio de "overdue" (24h) que el resto de este archivo.
async function getExternalSaleReviewPendingItem(href: string): Promise<PendingItem | null> {
  const rows = await prisma.externalSale.findMany({
    where: { reviewStatus: "PENDING", deletedAt: null },
    select: { code: true, createdAt: true },
  });
  if (rows.length === 0) return null;

  const cutoff = new Date(Date.now() - 24 * 60 * 60 * 1000);
  const overdue = rows.some((r) => r.createdAt < cutoff);
  return {
    type: "ventas_externas_revisar",
    icon: "🛍️",
    // Desde 2026-10-05 también las garantías locales (GL-000X) pasan por acá.
    label: "Ventas Externas — venta o garantía por aprobar",
    meta: `${rows.length === 1 ? rows[0].code : `${rows.length} por aprobar`}${overdue ? " · atrasado" : ""}`,
    overdue,
    href,
  };
}

// Confirmado 2026-09-09: pedido explícito de Daniel — misma condición exacta
// que /api/external-sales/pending-dispatch (ventas aprobadas por Bryan,
// esperando que Daniel asigne a quién de su equipo agrupa) — antes solo
// llegaba como aviso puntual (notifyInventoryLeadExternalSaleApproved en
// externalSales.ts). Confirmado 2026-09-21: ya no espera a que Nairoby
// facture primero en pago anticipado (ver pending-dispatch/route.ts).
async function getExternalSaleDispatchPendingItem(href: string): Promise<PendingItem | null> {
  const rows = await prisma.externalSale.findMany({
    where: {
      reviewStatus: "APPROVED",
      dispatchAssignedToId: null,
      deletedAt: null,
    },
    select: { code: true, reviewedAt: true, createdAt: true },
  });
  if (rows.length === 0) return null;

  const cutoff = new Date(Date.now() - 24 * 60 * 60 * 1000);
  const overdue = rows.some((r) => (r.reviewedAt ?? r.createdAt) < cutoff);
  return {
    type: "ventas_externas_agrupar",
    icon: "📦",
    label: "Ventas Externas — asignar quién agrupa",
    meta: `${rows.length === 1 ? rows[0].code : `${rows.length} ventas`}${overdue ? " · atrasado" : ""}`,
    overdue,
    href,
  };
}

// Pedido del usuario 2026-10-01 (tras fusionar Fulfillment en INVESTOCK):
// mismo hueco que agrupar — ventas ya agrupadas esperando que el Líder de
// Inventarios asigne quién embala y entrega (mismo filtro que
// /api/external-sales/pending-pack). Antes solo llegaba el aviso puntual
// notifyFulfilmentLeadExternalSalePrepReady.
async function getExternalSalePackPendingItem(href: string): Promise<PendingItem | null> {
  const rows = await prisma.externalSale.findMany({
    where: { prepReadyAt: { not: null }, packAssignedToId: null, deletedAt: null },
    select: { code: true, prepReadyAt: true },
  });
  if (rows.length === 0) return null;

  const cutoff = new Date(Date.now() - 24 * 60 * 60 * 1000);
  const overdue = rows.some((r) => r.prepReadyAt! < cutoff);
  return {
    type: "ventas_externas_embalar",
    icon: "📦",
    label: "Ventas Externas — asignar quién embala y entrega",
    meta: `${rows.length === 1 ? rows[0].code : `${rows.length} ventas`}${overdue ? " · atrasado" : ""}`,
    overdue,
    href,
  };
}

// Confirmado 2026-09-02: pedido explícito del usuario — el backfill
// automático de nichos (runNichoAutoBackfill en nichoAi.ts) corre solo todos
// los días mientras el gasto del mes no llegue al techo; en cuanto lo
// alcanza se detiene y se queda esperando que alguien confirme a mano con el
// botón "Sugerir nichos faltantes". Sin este pendiente, admin/Daniel solo se
// enterarían si entran a esa pestaña por su cuenta — por eso avisa en Inicio,
// para quien pueda gestionar Base de datos de productos (mismo criterio que
// canManageJustCatalog).
async function getNichoBackfillPendingItem(href: string): Promise<PendingItem | null> {
  const missingCount = await prisma.purchaseCatalogItem.count({ where: { nicho: null } });
  if (missingCount === 0) return null;

  const monthStart = new Date(Date.UTC(new Date().getUTCFullYear(), new Date().getUTCMonth(), 1));
  const spent = await prisma.aiUsageLog.aggregate({
    where: { feature: "combo_sugerencias_nicho", createdAt: { gte: monthStart } },
    _sum: { costUsd: true },
  });
  // Todavía hay margen este mes — el cron diario lo va a resolver solo, no
  // hace falta molestar a nadie.
  if ((spent._sum.costUsd ?? 0) < NICHO_AUTO_MONTHLY_BUDGET_USD) return null;

  return {
    type: "combo_sugerencias_nicho_backfill",
    icon: "🏷️",
    label: "Nichos de productos por asignar",
    meta: `${missingCount} producto${missingCount === 1 ? "" : "s"} · se llegó al tope de gasto mensual, confirma a mano en Base de datos de productos`,
    overdue: true,
    href,
  };
}

// Pedido del usuario 2026-09-30: el reporte mensual de ganadores ya no se
// sube a mano — los ganadores salen solos de los cortes (ver
// getCurrentWinners en comboSuggestions.ts), así que ya no hay recordatorio.

// Confirmado 2026-09-24, pedido de Nairoby: "que me notifique cuando un
// proceso no se cumpla o se pase por alto". Un solo pendiente que resume
// cada reclamo al proveedor trabado (ver getSupplierClaimGaps) — sigue
// apareciendo (y llegando en el aviso de las 8:00) mientras no se destrabe.
async function getSupplierClaimGapsPendingItem(href: string): Promise<PendingItem | null> {
  const g = await getSupplierClaimGaps();
  const parts: string[] = [];
  if (g.noGestion > 0) parts.push(`${g.noGestion} sin gestión del proveedor (+${CLAIM_GAP_DAYS.gestion} días)`);
  if (g.noPackage > 0) parts.push(`${g.noPackage} aceptado(s) sin paquete armado (+${CLAIM_GAP_DAYS.package} días)`);
  if (g.notArrived > 0) parts.push(`${g.notArrived} reemplazo(s) que no llegan (+${CLAIM_GAP_DAYS.arrival} días)`);
  if (g.doubles.length > 0) parts.push(`${g.doubles.length} posible(s) doble registro`);
  if (parts.length === 0) return null;
  return { type: "reclamos_proveedor_atrasados", icon: "⚠️", label: "Reclamos al proveedor trabados", meta: parts.join(" · "), overdue: true, href };
}

// Para Daniel: el mismo producto dañado está en la lista de devoluciones y
// en un deterioro sin unir — él es quien lo aclara (ver
// WeeklyDamageControl → "No es baja: se devolvió al proveedor").
async function getDamagedDoubleRegistrationPendingItem(href: string): Promise<PendingItem | null> {
  const pairs = await findPossibleDoubleRegistrations();
  if (pairs.length === 0) return null;
  return {
    type: "danados_doble_registro",
    icon: "⚠️",
    label: "Producto dañado registrado dos veces",
    meta: pairs.map((p) => `${p.name} (${p.reentryCode} y ${p.deteriorCode})`).join(" · "),
    overdue: true,
    href,
  };
}

// Confirmado 2026-08-21: pedido explícito del usuario — acceso directo con
// un solo clic para Nairoby cuando ya se cerró un lote semanal (solo, el
// sábado) y le falta a ella la verificación física + doble confirmación.
async function getMerchandiseWeeklyWriteOffVerificationPendingItem(href: string): Promise<PendingItem | null> {
  const rows = await prisma.merchandiseWeeklyWriteOffBatch.findMany({
    where: { justWrittenOffAt: { not: null }, nairobyConfirmedAt: null, items: { some: {} } },
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

// Confirmado 2026-09-21, pedido explícito del usuario: el precio ya NO lo
// fija Nairoby a mano — se calcula solo apenas Daniel confirma bodega (ver
// resolveAutoUnitPricing en personalPurchases.ts). Un pedido solo llega
// acá vivo (como pendiente de ACCIÓN para ella) si lo REABRIÓ ella misma
// para corregir un precio que ya estaba mal (priceReopenedAt no nulo) —
// nunca en el primer cierre. Ver getPersonalPurchaseAwaitingCostPendingItem
// para el otro caso (le faltó costo en INVESTOCK, no es acción de Nairoby).
async function getPersonalPurchasePendingFinanceItem(href: string): Promise<PendingItem | null> {
  const rows = await prisma.personalPurchaseOrder.findMany({
    where: { status: "PENDING_FINANCE", priceReopenedAt: { not: null } },
    select: { priceReopenedAt: true, employee: { select: { name: true } } },
  });
  if (rows.length === 0) return null;

  const cutoff = new Date(Date.now() - 24 * 60 * 60 * 1000);
  const overdue = rows.some((r) => (r.priceReopenedAt ?? new Date()) < cutoff);
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

// Confirmado 2026-09-21, pedido explícito del usuario: cuando el precio
// automático no se pudo calcular porque el producto todavía no tiene costo
// en ninguna de las 3 fuentes (propuesta/Kardex/Just), el pedido se queda
// esperando SIN que nadie lo pueda forzar a mano. Es puramente informativo
// (nadie tiene una acción concreta que tomar acá salvo cargar el costo en
// INVESTOCK) — solo para admin, para que no se pierda de vista.
async function getPersonalPurchaseAwaitingCostPendingItem(href: string): Promise<PendingItem | null> {
  const rows = await prisma.personalPurchaseOrder.findMany({
    where: { status: "PENDING_FINANCE", priceReopenedAt: null },
    select: { inventoryConfirmedAt: true, employee: { select: { name: true } } },
  });
  if (rows.length === 0) return null;

  const cutoff = new Date(Date.now() - 24 * 60 * 60 * 1000);
  const overdue = rows.some((r) => (r.inventoryConfirmedAt ?? new Date()) < cutoff);
  const names = rows.map((r) => r.employee.name).join(", ");
  return {
    type: "compras_personales_esperando_costo",
    icon: "⏳",
    label: "Compras personales — esperando costo en INVESTOCK",
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

// Confirmado 2026-09-07: el colaborador eligió pagar en efectivo — falta
// que Nairoby/FIN confirme con un clic que lo recibió en mano (ese clic
// también sube el monto a Caja Chica Principal, ver confirm-cash/route.ts).
// Sin campo de fecha propio para este estado (no hay "cashChosenAt"), así
// que a diferencia del resto de items de esta cola no se marca "atrasado".
async function getPersonalPurchaseCashConfirmPendingItem(href: string): Promise<PendingItem | null> {
  const rows = await prisma.personalPurchaseOrder.findMany({
    where: { status: "PENDING_CASH_CONFIRM" },
    select: { employee: { select: { name: true } } },
  });
  if (rows.length === 0) return null;

  const names = rows.map((r) => r.employee.name).join(", ");
  return {
    type: "compras_personales_efectivo",
    icon: "💵",
    label: "Compras personales — efectivo por confirmar",
    meta: rows.length === 1 ? names : `${rows.length} pedidos`,
    overdue: false,
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

// Confirmado 2026-08-31: pedido explícito del usuario — mismo patrón que
// getAdminPaymentsPendingItem, pero para "Ventas Externas": el asesor (hoy
// Heidy, Jariel, Yair o Marcos) sube el comprobante y el admin confirma con
// doble check que llegó el dinero (canConfirmExternalSalePayment en
// guards.ts, exclusivo de admin). Ya existía el push puntual
// (notifyAdminPaymentProofUploaded en externalSales.ts); esto agrega
// visibilidad persistente en Inicio hasta que se confirme, en vez de
// depender solo de la notificación del momento en que se subió.
async function getExternalSalePaymentConfirmPendingItem(href: string): Promise<PendingItem | null> {
  const pending = await prisma.externalSale.findMany({
    where: { reviewStatus: "APPROVED", paymentProofUrl: { not: null }, paymentConfirmedAt: null, deletedAt: null },
    select: { totalAmount: true },
  });
  if (pending.length === 0) return null;
  const total = pending.reduce((s, r) => s + r.totalAmount, 0);
  return {
    type: "ventas_externas_pago_confirmar",
    icon: "💵",
    label: "Ventas Externas — comprobante de pago por confirmar",
    meta: `${pending.length} venta${pending.length === 1 ? "" : "s"} · $${total.toFixed(2)}`,
    overdue: false,
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

// Plan de Mejora y Acompañamiento — confirmado 2026-09-10: recordatorio al
// líder para que no abandone el seguimiento semanal a mitad de camino (el
// punto donde más se caen estos procesos) y para que decida a tiempo cuando
// se vence el plazo de una etapa, en vez de dejar el plan "flotando" sin
// que nadie note que ya tocaba avanzar o cerrarlo. Aplica a CUALQUIER
// líder (no depende de dept.code) — un plan solo existe si él mismo lo
// abrió, así que basta con mirar los planes de su propio departamento.
const IMPROVEMENT_PLAN_REVIEW_OVERDUE_DAYS = 7;

// 2026-09-28: los planes que abrió el admin (leaderId=null, ver
// canActOnImprovementPlan) solo los gestiona él — antes el recordatorio le
// llegaba al líder del departamento (que puede ser la misma persona en el
// plan) y nunca al admin. forAdmin=true trae solo esos.
async function getImprovementPlanPendingItems(leaderDeptId: string | null, href: string): Promise<PendingItem[]> {
  const plans = await prisma.improvementPlan.findMany({
    where:
      leaderDeptId === null
        ? { leaderId: null, stage: { not: "CERRADO" } }
        : { deptId: leaderDeptId, leaderId: { not: null }, stage: { not: "CERRADO" } },
    select: {
      stage: true,
      stageDeadline: true,
      createdAt: true,
      collaborator: { select: { name: true } },
      reviews: { orderBy: { weekOf: "desc" }, take: 1, select: { weekOf: true } },
    },
  });
  if (plans.length === 0) return [];

  const now = Date.now();
  const items: PendingItem[] = [];
  for (const plan of plans) {
    // Etapa vencida es más urgente que la evaluación semanal — si ambas
    // aplican, solo se avisa la vencida para no duplicar el mismo caso.
    if (plan.stageDeadline.getTime() < now) {
      const daysOverdue = Math.floor((now - plan.stageDeadline.getTime()) / 86400000);
      items.push({
        type: "plan_mejora_etapa_vencida",
        icon: "⏰",
        label: "Plan de Mejora — etapa vencida",
        meta: `${plan.collaborator.name} · falta decidir cómo siguió, hace ${daysOverdue} día${daysOverdue === 1 ? "" : "s"}`,
        overdue: true,
        href,
      });
      continue;
    }
    const lastReviewAt = plan.reviews[0]?.weekOf ?? plan.createdAt;
    const daysSinceReview = Math.floor((now - lastReviewAt.getTime()) / 86400000);
    if (daysSinceReview >= IMPROVEMENT_PLAN_REVIEW_OVERDUE_DAYS) {
      items.push({
        type: "plan_mejora_evaluacion_pendiente",
        icon: "📋",
        label: "Plan de Mejora — evaluación pendiente",
        meta: `${plan.collaborator.name} · sin evaluación hace ${daysSinceReview} días`,
        overdue: true,
        href,
      });
    }
  }
  return items;
}

const IMPROVEMENT_PLAN_OUTCOME_LABEL: Record<string, string> = {
  REUBICACION: "Reubicación",
  REVISION_CONTINUIDAD: "Revisión de continuidad",
};

// Confirmado 2026-09-10: a diferencia del líder (que sí tiene un recordatorio
// repetido, ver getImprovementPlanPendingItems), al admin solo se le avisaba
// UNA vez por push cuando un líder pedía cerrar un plan hacia Reubicación o
// Revisión de continuidad (ver requestImprovementPlanClosure en
// improvementPlan.ts) — si lo pasaba por alto, no volvía a aparecer en
// ningún lado salvo que entrara manualmente a /admin/plan-mejora. Esto lo
// deja persistente en "Pendientes de esta semana" hasta que de verdad lo
// apruebe o lo rechace.
async function getImprovementPlanPendingClosureApprovalItems(href: string): Promise<PendingItem[]> {
  const plans = await prisma.improvementPlan.findMany({
    where: { pendingClosureOutcome: { not: null } },
    select: {
      pendingClosureOutcome: true,
      pendingClosureRequestedAt: true,
      collaborator: { select: { name: true } },
      dept: { select: { name: true } },
    },
  });
  const now = Date.now();
  return plans.map((p) => {
    const daysWaiting = p.pendingClosureRequestedAt ? Math.floor((now - p.pendingClosureRequestedAt.getTime()) / 86400000) : 0;
    return {
      type: "plan_mejora_cierre_aprobacion",
      icon: "🔒",
      label: "Plan de Mejora — cierre por aprobar",
      meta: `${p.collaborator.name} (${p.dept.name}) · ${IMPROVEMENT_PLAN_OUTCOME_LABEL[p.pendingClosureOutcome!] ?? p.pendingClosureOutcome} · esperando hace ${daysWaiting} día${daysWaiting === 1 ? "" : "s"}`,
      overdue: daysWaiting >= 2,
      href,
    };
  });
}

// Pedido del usuario 2026-10-01: Daniel no confirmaba cortes ya contados y el
// stock de INVESTOCK quedaba días atrás. Si algo que mueve el Kardex espera
// más de 24 horas a una persona, se le avisa al admin para que hable con ella:
// cortes contados (Daniel), compras recibidas sin aprobar (Daniel) y
// productos nuevos sin "Liberar al Kardex" (Bryan). La decisión sigue siendo
// de cada uno; esto solo avisa.
async function getKardexDelayAdminItems(deptIds: Map<string, string>): Promise<PendingItem[]> {
  const cutoff = new Date(Date.now() - 24 * 60 * 60 * 1000);
  const daysSince = (d: Date) => Math.max(1, Math.floor((Date.now() - d.getTime()) / (24 * 60 * 60 * 1000)));
  const comDept = deptIds.has("COM") ? { id: deptIds.get("COM")! } : null;
  const mktDept = deptIds.has("MKT") ? { id: deptIds.get("MKT")! } : null;
  // Mismo destino que adminLotHref() en fulfillmentPicking.ts.
  const lotsHref = deptIds.has("INV") ? `/admin/dept/${deptIds.get("INV")}?tab=egresos&otab=solicitud` : "/admin";
  const [counted, receipts, releases] = await Promise.all([
    getCountedUnconfirmedLots().then((l) => overdueCountedLots(l)),
    prisma.purchaseRequest.findMany({
      where: { status: "RECEIVED_PENDING_REVIEW", receipt: { confirmedAt: { lt: cutoff } } },
      select: { groupId: true, receipt: { select: { confirmedAt: true } } },
    }),
    getMarketProductKardexReleasePendingRows().then((rows) => rows.filter((r) => r.since < cutoff)),
  ]);
  const items: PendingItem[] = [];
  if (counted.length > 0) {
    const oldest = counted.reduce((m, l) => (l.readySince < m ? l.readySince : m), counted[0].readySince);
    items.push({
      type: "kardex_atrasado_cortes",
      icon: "🛑",
      label: "Daniel no confirma cortes ya contados",
      meta: `${counted.length} corte${counted.length === 1 ? "" : "s"} contado${counted.length === 1 ? "" : "s"} hace ${daysSince(oldest)}+ día(s) · el stock no baja hasta que confirme`,
      overdue: true,
      href: lotsHref,
    });
  }
  if (receipts.length > 0) {
    const groups = new Set(receipts.map((r) => r.groupId)).size;
    const oldest = receipts.reduce((m, r) => (r.receipt!.confirmedAt! < m ? r.receipt!.confirmedAt! : m), receipts[0].receipt!.confirmedAt!);
    items.push({
      type: "kardex_atrasado_recepciones",
      icon: "🛑",
      label: "Daniel no aprueba mercadería ya recibida",
      meta: `${groups} solicitud${groups === 1 ? "" : "es"} recibida${groups === 1 ? "" : "s"} por su equipo hace ${daysSince(oldest)}+ día(s) · no entra al stock hasta que apruebe`,
      overdue: true,
      href: comDept ? `/admin/dept/${comDept.id}?tab=compras` : "/admin",
    });
  }
  if (releases.length > 0) {
    const oldest = releases.reduce((m, r) => (r.since < m ? r.since : m), releases[0].since);
    const units = releases.reduce((s, r) => s + r.units, 0);
    items.push({
      type: "kardex_atrasado_liberar",
      icon: "🛑",
      label: "Bryan no libera productos nuevos al Kardex",
      meta: `${releases.length} producto${releases.length === 1 ? "" : "s"} (${units} u.) esperando hace ${daysSince(oldest)}+ día(s) · aparecen con stock 0 hasta que los libere`,
      overdue: true,
      href: mktDept ? `/admin/dept/${mktDept.id}?tab=analisis-mercado&ptab=trazabilidad` : "/admin",
    });
  }
  return items;
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
    // Pedido del usuario 2026-10-05 (Inicio tardaba): los ids de las cuatro
    // áreas en una sola consulta, no una por área.
    const deptIds = new Map(
      (await prisma.department.findMany({ where: { code: { in: ["FIN", "COM", "INV", "MKT"] } }, select: { id: true, code: true } })).map((d) => [d.code, d.id]),
    );
    const deptOf = (code: string) => (deptIds.has(code) ? { id: deptIds.get(code)! } : null);
    const finDept = deptOf("FIN");
    const financeHref = finDept ? `/admin/dept/${finDept.id}` : "/admin";
    // Confirmado 2026-08-13: Control de Compras vive en la página del
    // departamento COM (Compras) — mismo criterio que financeHref arriba —
    // y ambos pendientes de pago (mercadería y flete) se pagan desde su
    // pestaña interna "Finanzas" (?ptab=finanzas, leído por
    // PurchaseControlPanel).
    const comDept = deptOf("COM");
    const comCreditsHref = comDept ? `/admin/dept/${comDept.id}?tab=compras&ptab=urgentes` : "/admin";
    // Confirmado 2026-08-27: "Registro de Egresos" (donde vive la vista de
    // solo lectura de Cambio con proveedor) solo se ve desde la página del
    // departamento INV (ver canViewMerchandiseOutflow en admin/dept/[id]/page.tsx).
    const invDept = deptOf("INV");
    const invEgresosHref = invDept ? `/admin/dept/${invDept.id}?tab=egresos&otab=proveedor` : "/admin";
    const invStockHref = invDept ? `/admin/dept/${invDept.id}?tab=stock-actual` : "/admin";
    const comSolicitarHref = comDept ? `/admin/dept/${comDept.id}?tab=compras&ptab=solicitar` : "/admin";
    const comPriceCorrectionHref = comDept ? `/admin/dept/${comDept.id}?tab=compras&ptab=precio` : "/admin";
    const deterioroExcepcionesHref = "/admin/deterioro-excepciones";
    const nichoBackfillHref = "/admin/reingreso-mercaderia?tab=productos";
    // Confirmado 2026-08-31: "Ventas Externas" vive en la página del
    // departamento MKT (ver canViewExternalSales en admin/dept/[id]/page.tsx),
    // pestaña interna "Pagos" (?etab=pagos, leída por ExternalSalesPanel).
    const mktDept = deptOf("MKT");
    const mktVentasPagosHref = mktDept ? `/admin/dept/${mktDept.id}?tab=ventas-externas&etab=pagos` : "/admin";
    const [feedbackItems, recognitionItem, pettyCashLow, pettyCashUnconfirmed, adminPaymentsItem, purchaseShippingItem, purchaseCreditsItem, purchaseRefundBankConfirmItem, supplierExchangeRejectedItem, overtimeApprovalItem, commissionBonusApprovalItem, salaryAdvanceItem, managementDeductionItem, personalPurchaseFinanceItem, personalPurchaseAwaitingCostItem, personalPurchaseTransferConfirmItem, personalPurchaseTransferCloseItem, personalPurchaseCashConfirmItem, personalPurchasePaymentWatchItem, payrollTransferItem, payrollIessTransferItem, externalSalePaymentConfirmItem, birthdayItems, nichoBackfillItem, improvementPlanClosureItems, purchaseExceptionItem, stockAdjustmentItem, catalogDeleteItem, supplierAccountItem, freightExceptionItem, nairobySalaryItem, adminPlanItems, priceCorrectionItem, writeOffApprovalItem] = await Promise.all([
      getFeedbackPendingItems(),
      getRecognitionAdminPendingItem("/admin/colaborador-destacado"),
      getPettyCashLowBalanceItems(financeHref),
      getPettyCashUnconfirmedFunderItems(null, financeHref),
      getAdminPaymentsPendingItem(`${financeHref}?tab=pagosadmin`),
      // Pedido del usuario 2026-10-05: fletes por pagar y "esperando que el
      // colaborador resuelva el pago" los atiende Nairoby (Finanzas, ya los
      // ve en su Inicio) — el admin no hace nada ahí.
      Promise.resolve(null),
      getPurchaseCreditsPendingItem(comCreditsHref),
      getPurchaseRefundBankConfirmPendingItem(comCreditsHref),
      getSupplierExchangeRejectedAdminPendingItem(invEgresosHref),
      getOvertimeApprovalPendingItem("/admin/nomina?tab=pagos"),
      getCommissionAndBonusApprovalPendingItem("/admin/nomina"),
      getSalaryAdvancePendingItem("/admin/nomina?tab=pagos&ptab=anticipos"),
      getManagementDeductionUnacceptedPendingItem("/admin/nomina?tab=pagos&ptab=descuentos"),
      getPersonalPurchasePendingFinanceItem("/admin/nomina?tab=pagos&ptab=comprasfinanzas"),
      getPersonalPurchaseAwaitingCostPendingItem("/admin/nomina?tab=pagos&ptab=comprasfinanzas"),
      getPersonalPurchaseTransferConfirmPendingItem("/admin/nomina?tab=pagos&ptab=comprasfinanzas"),
      getPersonalPurchaseTransferClosePendingItem("/admin/nomina?tab=pagos&ptab=comprasfinanzas"),
      getPersonalPurchaseCashConfirmPendingItem("/admin/nomina?tab=pagos&ptab=comprasfinanzas"),
      Promise.resolve(null),
      getPayrollTransferPendingItem(true, "/admin/nomina?tab=pagos&ptab=roles"),
      getPayrollIessTransferPendingItem(true, "/admin/nomina?tab=pagos&ptab=roles"),
      getExternalSalePaymentConfirmPendingItem(mktVentasPagosHref),
      getUpcomingBirthdayPendingItems("/admin/nomina"),
      getNichoBackfillPendingItem(nichoBackfillHref),
      getImprovementPlanPendingClosureApprovalItems("/admin/plan-mejora"),
      getPurchaseExceptionAdminPendingItem(deterioroExcepcionesHref),
      getStockAdjustmentAdminPendingItem(invStockHref),
      getPurchaseCatalogDeleteRequestAdminPendingItem(comSolicitarHref),
      getSupplierBankAccountVerifyAdminPendingItem("/admin/proveedores?verificar=1"),
      getPettyCashFreightExceptionAdminPendingItem(financeHref),
      getPayrollNairobySalaryTransferPendingItem(true, "/admin/nomina?tab=pagos&ptab=roles"),
      getImprovementPlanPendingItems(null, "/admin/plan-mejora"),
      getPriceCorrectionAdminPendingItem(comPriceCorrectionHref),
      getWriteOffApprovalAdminPendingItem(comCreditsHref),
    ]);
    const items = [
      ...feedbackItems,
      ...improvementPlanClosureItems,
      ...(recognitionItem ? [recognitionItem] : []),
      ...pettyCashLow,
      ...pettyCashUnconfirmed,
      ...(adminPaymentsItem ? [adminPaymentsItem] : []),
      ...(purchaseShippingItem ? [purchaseShippingItem] : []),
      ...(purchaseCreditsItem ? [purchaseCreditsItem] : []),
      ...(purchaseRefundBankConfirmItem ? [purchaseRefundBankConfirmItem] : []),
      ...(supplierExchangeRejectedItem ? [supplierExchangeRejectedItem] : []),
      ...(overtimeApprovalItem ? [overtimeApprovalItem] : []),
      ...(commissionBonusApprovalItem ? [commissionBonusApprovalItem] : []),
      ...(salaryAdvanceItem ? [salaryAdvanceItem] : []),
      ...(managementDeductionItem ? [managementDeductionItem] : []),
      ...(personalPurchaseFinanceItem ? [personalPurchaseFinanceItem] : []),
      ...(personalPurchaseAwaitingCostItem ? [personalPurchaseAwaitingCostItem] : []),
      ...(personalPurchaseTransferConfirmItem ? [personalPurchaseTransferConfirmItem] : []),
      ...(personalPurchaseTransferCloseItem ? [personalPurchaseTransferCloseItem] : []),
      ...(personalPurchaseCashConfirmItem ? [personalPurchaseCashConfirmItem] : []),
      ...(personalPurchasePaymentWatchItem ? [personalPurchasePaymentWatchItem] : []),
      ...(payrollTransferItem ? [payrollTransferItem] : []),
      ...(payrollIessTransferItem ? [payrollIessTransferItem] : []),
      ...(externalSalePaymentConfirmItem ? [externalSalePaymentConfirmItem] : []),
      ...birthdayItems,
      ...(nichoBackfillItem ? [nichoBackfillItem] : []),
      ...(purchaseExceptionItem ? [purchaseExceptionItem] : []),
      ...(stockAdjustmentItem ? [stockAdjustmentItem] : []),
      ...(await getStockCountApprovalPendingItem(invStockHref).then((i) => (i ? [i] : [])).catch(() => [])),
      ...(priceCorrectionItem ? [priceCorrectionItem] : []),
      ...(writeOffApprovalItem ? [writeOffApprovalItem] : []),
      ...(catalogDeleteItem ? [catalogDeleteItem] : []),
      ...(supplierAccountItem ? [supplierAccountItem] : []),
      ...(freightExceptionItem ? [freightExceptionItem] : []),
      ...(nairobySalaryItem ? [nairobySalaryItem] : []),
      ...adminPlanItems.map((i) => ({ ...i, type: "plan_mejora_admin" })),
    ];
    // Pedido del usuario 2026-10-01: lo que no entra al Kardex porque alguien
    // no confirmó en 24 horas va arriba de todo (y sale en el aviso de las 8:00).
    items.unshift(...(await getKardexDelayAdminItems(deptIds)));
    if (items.length === 0) return null;
    return { title: "Pendientes de esta semana", sub: "Como administrador", items };
  }

  const me = await prisma.user.findUnique({
    where: { id: actor.userId },
    select: {
      isLeader: true,
      leadsDeptId: true,
      canManagePurchases: true,
      canApprovePurchaseRequests: true,
      canBrandMarketProduct: true,
      canConfirmMarketingDesign: true,
      canResolveSupplierStockout: true,
      canPublishMarketProduct: true,
      canLinkStoreProducts: true,
      canMarkComboCreatedInDropi: true,
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
  const myPettyCashConfirmationItems = [
    ...(await getMyPettyCashConfirmationPendingItems(actor.userId, "/area/workspace")),
    ...(await getMyMotorizadoFreightPendingItems(actor.userId, "/area/workspace")),
  ];
  const myPayrollMessageItem = await getMyPayrollMessageUnreadPendingItem(actor.userId, "/area/roles-de-pago");

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
    teamItems.push(...myPettyCashConfirmationItems);
    if (myPayrollMessageItem) teamItems.push(myPayrollMessageItem);
    teamItems.unshift(...(await getMyFulfillmentBlockPendingItems(actor.userId, "/area/workspace?tab=egresos&otab=solicitud")));
    teamItems.unshift(...(await getMyLocalWarrantyPendingItems(actor.userId, "/area/workspace?tab=ventas-externas&etab=garantias")));
    if (me.department?.code === "INV") {
      teamItems.unshift(...(await getStockCountPendingItems(false, actor.userId).catch(() => [])));
      const pickupItem = await getLocalWarrantyPickupPendingItem("/area/workspace?tab=ventas-externas&etab=devoluciones");
      if (pickupItem) teamItems.unshift(pickupItem);
      const [receivingItem, replacementItem, urgentUnresolvedItem] = await Promise.all([
        getPurchaseReceivingPendingItem("/area/workspace?tab=compras&ptab=inventario", false),
        getPurchaseReplacementVerificationPendingItem("/area/workspace?tab=compras&ptab=inventario"),
        getPurchaseUrgentReportsUnresolvedPendingItem("/area/workspace?tab=compras&ptab=urgentes"),
      ]);
      const linesToConfirmItem = await getLinesToConfirmPendingItem();
      if (linesToConfirmItem) teamItems.unshift(linesToConfirmItem);
      if (receivingItem) teamItems.push(receivingItem);
      if (replacementItem) teamItems.push(replacementItem);
      if (urgentUnresolvedItem) teamItems.push(urgentUnresolvedItem);
    }
    // Confirmado 2026-09-18, pedido de Jariel: contraparte en Inicio de su
    // propia bandeja "Listo para comprar" (Análisis de Mercado) — Jariel es
    // miembro de MKT pero no su líder (Bryan lo es), así que cae acá igual
    // que el bloque de INV arriba.
    if (me.department?.code === "MKT") {
      const marketProductReadyToBuyItem = await getMarketProductReadyToBuyPendingItem("/area/workspace?tab=analisis-mercado");
      if (marketProductReadyToBuyItem) teamItems.push(marketProductReadyToBuyItem);
    }
    if (me.canBrandMarketProduct || me.canConfirmMarketingDesign) {
      const marketProductBrandItem = await getMarketProductBrandPendingItem("/area/workspace?tab=nuevos-ids");
      if (marketProductBrandItem) teamItems.push(marketProductBrandItem);
    }
    // Confirmado 2026-09-23, pedido de Jariel: Heidy resuelve "Sin stock de
    // proveedor" vía este flag delegado sin liderar ningún departamento —
    // mismo criterio que canBrandMarketProduct arriba.
    if (me.canResolveSupplierStockout) {
      const discontinuedItem = await getDropiDiscontinuedPendingItem();
      if (discontinuedItem) teamItems.unshift(discontinuedItem);
      const supplierStockoutItem = await getSupplierStockoutPendingItem("/area/workspace?tab=analisis-mercado&ptab=sinstock");
      if (supplierStockoutItem) teamItems.push(supplierStockoutItem);
    }
    if (me.canPublishMarketProduct) {
      const missingIdItem = await getCatalogMissingDropiIdPendingItem("/area/workspace?tab=analisis-mercado&ptab=publicar");
      if (missingIdItem) teamItems.push(missingIdItem);
      const inTransitItem = await getPurchaseInTransitUnpublishedPendingItem("/area/workspace?tab=analisis-mercado&ptab=publicar");
      if (inTransitItem) teamItems.unshift(inTransitItem);
      const priceChangeItem = await getDropiPriceChangesPendingItem("/area/workspace?tab=analisis-mercado&ptab=publicar");
      if (priceChangeItem) teamItems.unshift(priceChangeItem);
    }
    if (me.canMarkComboCreatedInDropi) {
      const combosItem = await getWeeklyComboSuggestionsPendingItem();
      if (combosItem) teamItems.push(combosItem);
    }
    if (me.canLinkStoreProducts) {
      const storeTrackingItem = await getStoreTrackingUnlinkedPendingItem();
      if (storeTrackingItem) teamItems.push(storeTrackingItem);
    }
    // Pedido del usuario 2026-10-03: se autofiltra por proposedById.
    teamItems.push(...(await getMarketProposerPendingItems(actor.userId)));
    // Confirmado 2026-09-03: Jariel (transición Bryan→Jariel en Compras) es
    // delegado vía canManagePurchases pero no lidera ningún departamento —
    // mismo criterio de elegibilidad que canSubmitPurchaseRequests
    // (guards.ts) y que el bloque de líder más abajo, para que sus propias
    // solicitudes de compra pendientes y los créditos con proveedores le
    // aparezcan en Inicio igual que a un líder de COM/FIN.
    if (me.canManagePurchases) {
      const purchaseRequesterItems = await getPurchaseRequesterPendingItems(actor.userId, "/area/workspace?tab=compras&ptab=mias");
      teamItems.push(...purchaseRequesterItems);
      const purchaseCreditsItem = await getPurchaseCreditsPendingItem("/area/workspace?tab=compras&ptab=urgentes");
      if (purchaseCreditsItem) teamItems.push(purchaseCreditsItem);
      // Confirmado 2026-09-15: bug real — a Jariel (canManagePurchases, quien
      // hoy coordina con el proveedor en "Reportes urgentes") nunca le
      // aparecía este aviso en Inicio porque solo estaba conectado para el
      // líder/equipo de Inventario más arriba. Mismo generador que ya usa
      // Daniel (getPurchaseUrgentReportsUnresolvedPendingItem), mismo href
      // que aprove/route.ts ahora manda en la notificación.
      const purchaseUrgentUnresolvedItem = await getPurchaseUrgentReportsUnresolvedPendingItem("/area/workspace?tab=compras&ptab=urgentes", {
        label: "Mercadería faltante o dañada — coordina la solución con el proveedor",
      });
      if (purchaseUrgentUnresolvedItem) teamItems.push(purchaseUrgentUnresolvedItem);
      const purchaseGestionItem = await getPurchaseGestionPendingItem("/area/workspace?tab=compras&ptab=urgentes");
      if (purchaseGestionItem) teamItems.push(purchaseGestionItem);
      const shortReceiptsItem = await getShortReceiptsUnclaimedPendingItem("/area/workspace?tab=compras&ptab=urgentes");
      if (shortReceiptsItem) teamItems.unshift(shortReceiptsItem);
      const excessGestionItem = await getPurchaseExcessPendingItem("gestion", "/area/workspace?tab=compras&ptab=urgentes");
      if (excessGestionItem) teamItems.push(excessGestionItem);
    }
    // Confirmado 2026-09-04: quien aprueba compras (hoy Bryan) puede no
    // liderar ningún departamento — mismo patrón que canManagePurchases
    // arriba, para que le aparezca igual sin depender de ser líder.
    if (me.canApprovePurchaseRequests) {
      const purchaseApprovalItem = await getPurchaseApprovalPendingItem("/area/workspace?tab=compras&ptab=aprobacion");
      if (purchaseApprovalItem) teamItems.push(purchaseApprovalItem);
      const excessConfirmItem = await getPurchaseExcessPendingItem("confirmar", "/area/workspace?tab=compras&ptab=urgentes");
      if (excessConfirmItem) teamItems.push(excessConfirmItem);
      if (!me.canManagePurchases) {
        const myClaimsItem = await getPurchaseUrgentReportsUnresolvedPendingItem("/area/workspace?tab=compras&ptab=urgentes", {
          label: "Reclamos de tus compras sin resolver con el proveedor (seguimiento)",
          requestedById: actor.userId,
        });
        if (myClaimsItem) teamItems.push({ ...myClaimsItem, overdue: false });
        const myShortItem = await getShortReceiptsUnclaimedPendingItem("/area/workspace?tab=compras&ptab=urgentes", actor.userId);
        if (myShortItem) teamItems.unshift(myShortItem);
      }
    }
    // Confirmado 2026-09-29 (idea de Daniel): "Qué comprar" — Jariel ve sus
    // compras calientes aunque no lidere ningún departamento.
    teamItems.unshift(...(await getPurchaseSuggestionPendingItems(actor.userId)));
    // Confirmado 2026-09-29 (pedido de Daniel): Producto que despierta —
    // Jariel y Heidy no lideran ningún departamento.
    teamItems.unshift(...(await getSuddenDemandPendingItems(actor.userId)));
    if (teamItems.length === 0) return null;
    return { title: "Pendientes de esta semana", sub: me.department?.code === "INV" ? "En Inventario" : "Para ti", items: teamItems };
  }

  const items: PendingItem[] = [];
  if (myDeductionItem) items.push(myDeductionItem);
  if (myBankAccountItem) items.push(myBankAccountItem);
  if (myPersonalPurchasePaymentItem) items.push(myPersonalPurchasePaymentItem);
  if (myPersonalPurchaseStatusItem) items.push(myPersonalPurchaseStatusItem);
  items.push(...myPettyCashConfirmationItems);
  if (myPayrollMessageItem) items.push(myPayrollMessageItem);
  items.unshift(...(await getMyLocalWarrantyPendingItems(actor.userId, "/area/workspace?tab=ventas-externas&etab=garantias")));
  let monthly = false;

  if (me.leadsDept.code === "FIN") {
    monthly = true;
    const [payStub, externalPayment, returnRate, warranty, paymentReminders, storeFeedback, pettyCashLow, pettyCashUnconfirmed, purchaseShippingItem, managementDeductionItem, personalPurchaseFinanceItem, personalPurchaseTransferCloseItem, personalPurchaseCashConfirmItem, personalPurchasePaymentWatchItem, merchandiseWeeklyVerificationItem, payrollTransferItem, payrollIessTransferItem] = await Promise.all([
      getPayStubPendingItem("/area/roles-de-pago"),
      getExternalPaymentPendingItem("/area/roles-de-pago?ptab=factura"),
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
      getPersonalPurchaseCashConfirmPendingItem("/area/nomina?tab=pagos&ptab=comprasfinanzas"),
      getPersonalPurchasePaymentWatchItem("/area/nomina?tab=pagos&ptab=comprasfinanzas"),
      getMerchandiseWeeklyWriteOffVerificationPendingItem("/area/reingreso-mercaderia?tab=danos"),
      getPayrollTransferPendingItem(false, "/area/nomina?tab=pagos&ptab=roles"),
      getPayrollIessTransferPendingItem(false, "/area/nomina?tab=pagos&ptab=roles"),
    ]);
    items.push(...pettyCashLow, ...pettyCashUnconfirmed);
    if (payStub) items.push(payStub);
    if (externalPayment) items.push(externalPayment);
    if (returnRate) items.push(returnRate);
    if (warranty) items.push(warranty);
    items.push(...paymentReminders);
    if (storeFeedback) items.push(storeFeedback);
    if (purchaseShippingItem) items.push(purchaseShippingItem);
    if (personalPurchasePaymentWatchItem) items.push(personalPurchasePaymentWatchItem);
    if (managementDeductionItem) items.push(managementDeductionItem);
    if (personalPurchaseFinanceItem) items.push(personalPurchaseFinanceItem);
    if (personalPurchaseTransferCloseItem) items.push(personalPurchaseTransferCloseItem);
    if (personalPurchaseCashConfirmItem) items.push(personalPurchaseCashConfirmItem);
    if (merchandiseWeeklyVerificationItem) items.push(merchandiseWeeklyVerificationItem);
    const claimGapsItem = await getSupplierClaimGapsPendingItem("/area/workspace?tab=egresos&otab=seguimiento").catch(() => null);
    if (claimGapsItem) items.push(claimGapsItem);
    if (payrollTransferItem) items.push(payrollTransferItem);
    if (payrollIessTransferItem) items.push(payrollIessTransferItem);

    const financeWriteOffItem = await getSupplierExchangeFinanceWriteOffPendingItem("/area/workspace?tab=egresos&otab=proveedor");
    if (financeWriteOffItem) items.push(financeWriteOffItem);

    const payrollMessagesManagerItem = await getPayrollMessagesUnreadForManagerPendingItem("/area/roles-de-pago");
    if (payrollMessagesManagerItem) items.push(payrollMessagesManagerItem);
  }

  if (me.leadsDept.trackWeeklyMetric) {
    const item = await getWeeklyMetricPendingItem(me.leadsDeptId, "/area/workspace");
    if (item) items.push(item);
    const justificationItem = await getFillRateJustificationPendingItem(me.leadsDeptId, "/area/workspace");
    if (justificationItem) items.push(justificationItem);
  }

  if (me.leadsDept.code === "INV") {
    const [receivingItem, replacementItem, inventoryControlItem, merchandiseReentryItem, personalPurchaseInventoryItem, lateClaimReviewItem, urgentUnresolvedItem, nichoBackfillItem, deteriorResolutionItem, externalSaleDispatchItem] = await Promise.all([
      getPurchaseReceivingPendingItem("/area/workspace?tab=compras&ptab=inventario", true),
      getPurchaseReplacementVerificationPendingItem("/area/workspace?tab=compras&ptab=inventario"),
      getInventoryControlPendingItem("/area/workspace?tab=inventario"),
      getMerchandiseReentryPendingItem("/area/reingreso-mercaderia?tab=revision"),
      getPersonalPurchasePendingInventoryItem("/area/compras-personales-inventario"),
      getLateClaimReviewPendingItem("/area/workspace?tab=compras&ptab=inventario"),
      getPurchaseUrgentReportsUnresolvedPendingItem("/area/workspace?tab=compras&ptab=urgentes"),
      getNichoBackfillPendingItem("/area/reingreso-mercaderia?tab=productos"),
      getDeteriorResolutionPendingItem("/area/workspace?tab=egresos&otab=deterioro"),
      getExternalSaleDispatchPendingItem("/area/workspace?tab=ventas-externas&etab=despacho"),
    ]);
    const linesToConfirmItem = await getLinesToConfirmPendingItem();
    if (linesToConfirmItem) items.unshift(linesToConfirmItem);
    if (receivingItem) items.push(receivingItem);
    if (replacementItem) items.push(replacementItem);
    if (inventoryControlItem) items.push(inventoryControlItem);
    if (merchandiseReentryItem) items.push(merchandiseReentryItem);
    if (personalPurchaseInventoryItem) items.push(personalPurchaseInventoryItem);
    if (lateClaimReviewItem) items.push(lateClaimReviewItem);
    if (urgentUnresolvedItem) items.push(urgentUnresolvedItem);
    if (nichoBackfillItem) items.push(nichoBackfillItem);
    if (deteriorResolutionItem) items.push(deteriorResolutionItem);
    const expirationLotsItem = await getExpirationLotsPendingItem("/area/reingreso-mercaderia?tab=productos#lotes-caducidad").catch(() => null);
    if (expirationLotsItem) items.push(expirationLotsItem);
    const missingBrandItem = await getMissingBrandPendingItem("/area/workspace?tab=stock-actual").catch(() => null);
    if (missingBrandItem) items.push(missingBrandItem);
    const missingAreaItem = await getMissingWarehouseAreaPendingItem("/area/workspace?tab=stock-actual&filtro=sin-area").catch(() => null);
    if (missingAreaItem) items.push(missingAreaItem);
    const inspectionItem = await getDeteriorInspectionPendingItem("/area/workspace?tab=egresos&otab=seguimiento").catch(() => null);
    if (inspectionItem) items.push(inspectionItem);
    const doubleRegItem = await getDamagedDoubleRegistrationPendingItem("/area/reingreso-mercaderia?tab=danos").catch(() => null);
    if (doubleRegItem) items.push(doubleRegItem);
    if (externalSaleDispatchItem) items.push(externalSaleDispatchItem);
    const externalSalePackItem = await getExternalSalePackPendingItem("/area/workspace?tab=ventas-externas&etab=despacho");
    if (externalSalePackItem) items.push(externalSalePackItem);
    const warrantyPickupItem = await getLocalWarrantyPickupPendingItem("/area/workspace?tab=ventas-externas&etab=devoluciones");
    if (warrantyPickupItem) items.push(warrantyPickupItem);
    items.unshift(...(await getStockCountPendingItems(true, actor.userId).catch(() => [])));
    const negativeStockItem = await getNegativeStockPendingItem("/area/workspace?tab=stock-actual").catch(() => null);
    if (negativeStockItem) items.unshift(negativeStockItem);
    const manifestCatchUpItem = await getManifestCatchUpPendingItem("/area/workspace?tab=egresos&otab=solicitud");
    if (manifestCatchUpItem) items.unshift(manifestCatchUpItem);
    // Pedido del usuario 2026-10-02: Daniel decide él mismo los posibles
    // productos duplicados (juntar o "no son el mismo").
    const duplicates = await findDuplicateCandidates().catch(() => []);
    if (duplicates.length > 0) {
      items.push({
        type: "catalogo_posibles_duplicados",
        icon: "🧩",
        label: "Posibles productos duplicados — decide si se juntan",
        meta: duplicates.length === 1 ? `${duplicates[0].a.name} / ${duplicates[0].b.name}` : `${duplicates.length} pares por revisar`,
        overdue: false,
        href: "/area/reingreso-mercaderia?tab=productos",
      });
    }
    const excessKardexItem = await getPurchaseExcessPendingItem("kardex", "/area/workspace?tab=compras&ptab=inventario");
    if (excessKardexItem) items.push(excessKardexItem);
    const catalogMissingItem = await getCatalogMissingReportPendingItem("/area/reingreso-mercaderia?tab=productos");
    if (catalogMissingItem) items.push(catalogMissingItem);
    items.unshift(...(await getFulfillmentLotSentPendingItems("/area/workspace?tab=egresos&otab=solicitud")));
  }

  if (me.leadsDept.code === "MKT") {
    const marketProductReviewItem = await getMarketProductReviewPendingItem("/area/workspace?tab=analisis-mercado");
    if (marketProductReviewItem) items.push(marketProductReviewItem);
    const rejectedPurchaseProposalItem = await getMarketProposalRejectedPurchasePendingItem("/area/workspace?tab=analisis-mercado&ptab=trazabilidad");
    if (rejectedPurchaseProposalItem) items.push(rejectedPurchaseProposalItem);
    const kardexReleaseItem = await getMarketProductKardexReleasePendingItem("/area/workspace?tab=analisis-mercado&ptab=trazabilidad");
    if (kardexReleaseItem) items.unshift(kardexReleaseItem);
    const externalSaleReviewItem = await getExternalSaleReviewPendingItem("/area/workspace?tab=ventas-externas&etab=revision");
    if (externalSaleReviewItem) items.push(externalSaleReviewItem);
    // Confirmado 2026-09-23, pedido de Jariel: Bryan resuelve "Sin stock de
    // proveedor" por ser líder de MKT (ver canResolveSupplierStockout en
    // guards.ts, que entra por liderazgo sin necesitar el flag delegado).
    const supplierStockoutItem = await getSupplierStockoutPendingItem("/area/workspace?tab=analisis-mercado&ptab=sinstock");
    if (supplierStockoutItem) items.push(supplierStockoutItem);
    const discontinuedOrderItem = await getDropiDiscontinuedOrderPendingItem();
    if (discontinuedOrderItem) items.unshift(discontinuedOrderItem);
  }

  if (me.canBrandMarketProduct || me.canConfirmMarketingDesign) {
    const marketProductBrandItem = await getMarketProductBrandPendingItem("/area/workspace?tab=nuevos-ids");
    if (marketProductBrandItem) items.push(marketProductBrandItem);
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
  items.push(...(await getMarketProposerPendingItems(actor.userId)));
  if (me.leadsDept.code === "FIN") {
    const coldReadyToBuyItem = await getMarketProductReadyToBuyPendingItem("/area/workspace?tab=analisis-mercado&ptab=listoparacomprar", "cold");
    if (coldReadyToBuyItem) items.push(coldReadyToBuyItem);
  }

  const supplierExchangeGestorItem = await getSupplierExchangeGestorPendingItem(actor.userId, "/area/workspace?tab=egresos&otab=proveedor");
  if (supplierExchangeGestorItem) items.push(supplierExchangeGestorItem);

  const improvementPlanItems = await getImprovementPlanPendingItems(me.leadsDeptId, "/area/workspace?tab=plan-mejora");
  items.push(...improvementPlanItems);

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
  if (me.canManagePurchases) {
    const purchaseGestionItem = await getPurchaseGestionPendingItem("/area/workspace?tab=compras&ptab=urgentes");
    if (purchaseGestionItem) items.push(purchaseGestionItem);
    const shortReceiptsItem = await getShortReceiptsUnclaimedPendingItem("/area/workspace?tab=compras&ptab=urgentes");
    if (shortReceiptsItem) items.unshift(shortReceiptsItem);
    const excessGestionItem = await getPurchaseExcessPendingItem("gestion", "/area/workspace?tab=compras&ptab=urgentes");
    if (excessGestionItem) items.push(excessGestionItem);
  }

  // Confirmado 2026-09-04: pedido explícito del usuario — quien aprueba
  // compras (hoy Bryan) debe ver en su propio Inicio lo que tiene pendiente
  // de aprobar, separado de lo que el admin ve como "pendiente de pagar"
  // (ver getPurchaseMerchandisePaymentsSummary, que ahora solo cuenta
  // APPROVED).
  if (me.canApprovePurchaseRequests) {
    const purchaseApprovalItem = await getPurchaseApprovalPendingItem("/area/workspace?tab=compras&ptab=aprobacion");
    if (purchaseApprovalItem) items.push(purchaseApprovalItem);
    const excessConfirmItem = await getPurchaseExcessPendingItem("confirmar", "/area/workspace?tab=compras&ptab=urgentes");
    if (excessConfirmItem) items.push(excessConfirmItem);
    if (!me.canManagePurchases) {
      const myClaimsItem = await getPurchaseUrgentReportsUnresolvedPendingItem("/area/workspace?tab=compras&ptab=urgentes", {
        label: "Reclamos de tus compras sin resolver con el proveedor (seguimiento)",
        requestedById: actor.userId,
      });
      if (myClaimsItem) items.push({ ...myClaimsItem, overdue: false });
      const myShortItem = await getShortReceiptsUnclaimedPendingItem("/area/workspace?tab=compras&ptab=urgentes", actor.userId);
      if (myShortItem) items.unshift(myShortItem);
    }
  }

  // Confirmado 2026-09-29 (idea de Daniel): compras frías a Nairoby, y a
  // Daniel los urgentes que llevan 3+ días sin comprarse.
  items.unshift(...(await getPurchaseSuggestionPendingItems(actor.userId)));
  // Pedido del usuario 2026-10-01: los cortes contados sin confirmar van
  // siempre arriba de todo en el Inicio de Daniel.
  const countedIdx = items.findIndex((i) => i.type === "fulfillment_cortes_sin_confirmar");
  if (countedIdx > 0) items.unshift(...items.splice(countedIdx, 1));
  // Confirmado 2026-09-29 (pedido de Daniel): Producto que despierta — Daniel,
  // Bryan Rios, Yair; Nairoby solo si el producto tiene 31 a 60 en bodega.
  items.unshift(...(await getSuddenDemandPendingItems(actor.userId)));

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
    types.push("feedback", "caja_chica_saldo", "caja_chica_confirmacion", "cumpleanos", "compras_creditos_pendientes", "anticipos_aprobacion", "descuentos_sin_aceptar", "compras_personales_precio", "compras_personales_transferencia", "compras_personales_cierre", "nomina_transferencia", "iess_transferencia", "combo_sugerencias_nicho_backfill", "plan_mejora_cierre_aprobacion", "deterioro_compras_excepcion", "ajuste_stock_conteo", "catalogo_compras_borrado", "cuenta_proveedor_verificar", "caja_chica_excepcion_flete", "sueldo_nairoby_transferencia", "plan_mejora_admin", "correccion_precio_compra", "perdida_compra_aprobar");
  } else {
    const me = await prisma.user.findUnique({
      where: { id: actor.userId },
      select: {
        isLeader: true,
        leadsDeptId: true,
        canManagePurchases: true,
        canApprovePurchaseRequests: true,
        canBrandMarketProduct: true,
        canConfirmMarketingDesign: true,
        canPublishMarketProduct: true,
        canLinkStoreProducts: true,
        canMarkComboCreatedInDropi: true,
        leadsDept: { select: { code: true, trackWeeklyMetric: true } },
        department: { select: { code: true } },
      },
    });
    if (!me) return [];
    if (!me.isLeader || !me.leadsDeptId || !me.leadsDept) {
      // Delegado sin liderar ningún departamento (p.ej. Jariel vía
      // canManagePurchases) — mismo criterio que el bloque de compras más
      // abajo, pero sin nada del resto (KPIs, roles de pago, etc.) que sigue
      // siendo exclusivo de líderes.
      if (me.canManagePurchases) {
        types.push("compras_rechazadas", "compras_transportista", "compras_cuenta_bancaria", "compras_creditos_pendientes", "deterioro_compras_gestion", "compras_excedente_gestion");
      }
      if (me.canApprovePurchaseRequests) types.push("compras_pendientes_aprobacion", "compras_excedente_confirmar");
      // Confirmado 2026-09-18: Jariel es miembro de MKT (canProposeMarketProduct)
      // pero no su líder — mismo criterio que el resto de este bloque.
      if (me.department?.code === "MKT") types.push("analisis_mercado_listo_comprar", "analisis_mercado_rechazadas", "analisis_mercado_aprobadas_sin_compra");
      if (me.canBrandMarketProduct || me.canConfirmMarketingDesign) types.push("analisis_mercado_brandear");
      if (me.canPublishMarketProduct) types.push("analisis_mercado_sin_id", "analisis_mercado_compra_en_camino", "precio_dropi_cambio");
      if (me.canMarkComboCreatedInDropi) types.push("combos_semana");
      if (me.canLinkStoreProducts) types.push("seguimiento_tiendas_sin_tienda");
      if (me.department?.code === "INV") types.push("fulfillment_bloque_asignado");
      if (me.canManagePurchases && me.department?.code === "MKT") types.push("compras_calientes");
      return types.map((type) => ({ type, label: PENDING_TYPE_CATALOG[type] }));
    }

    types.push("cumpleanos", "plan_mejora_evaluacion_pendiente", "plan_mejora_etapa_vencida");
    if (me.canBrandMarketProduct || me.canConfirmMarketingDesign) types.push("analisis_mercado_brandear");
    if (me.canPublishMarketProduct) types.push("analisis_mercado_sin_id", "analisis_mercado_compra_en_camino", "precio_dropi_cambio");
      if (me.canMarkComboCreatedInDropi) types.push("combos_semana");
    if (me.canLinkStoreProducts) types.push("seguimiento_tiendas_sin_tienda");
    if (me.leadsDept.code === "FIN") types.push("compras_frias", "analisis_mercado_listo_comprar", "analisis_mercado_rechazadas", "analisis_mercado_aprobadas_sin_compra");
    if (me.leadsDept.code === "INV") types.push("compras_urgentes_sin_atender");
    if (me.leadsDept.code === "FIN") {
      types.push("roles_de_pago", "tasa_devolucion", "kpi_garantias", "pagos_recordatorios", "servicio_postventa", "caja_chica_saldo", "caja_chica_confirmacion", "descuentos_sin_aceptar", "compras_personales_precio", "compras_personales_cierre", "reingreso_mercaderia_verificacion_semanal", "nomina_transferencia", "iess_transferencia", "reclamos_proveedor_atrasados");
    }
    if (me.leadsDept.trackWeeklyMetric) types.push("pedidos_despachados", "fillrate_justificacion_pendiente");
    if (me.leadsDept.code === "INV") {
      types.push("compras_recepcion", "compras_cambios_verificar", "control_inventario", "reingreso_mercaderia_revision", "compras_personales_confirmar", "compras_reclamo_posterior_revision", "combo_sugerencias_nicho_backfill", "egresos_deterioro_resolucion", "lotes_caducidad_alerta", "ids_sin_marca", "productos_sin_area", "ventas_externas_agrupar", "ventas_externas_embalar", "garantia_local_recogida", "manifiestos_tras_feriado", "catalogo_posibles_duplicados", "conteo_inventario", "stock_negativo", "compras_excedente_kardex", "danados_doble_registro", "fulfillment_corte_enviado", "catalogo_producto_faltante");
    }
    // Mismo criterio de elegibilidad que canSubmitPurchaseRequests
    // (guards.ts) — delegado vía canManagePurchases, o líder de COM/FIN —
    // pero calculado acá sin sesión, para poder listar los tipos posibles de
    // cualquier líder (usado también por el barrido del cron).
    if (me.canManagePurchases || ["COM", "FIN"].includes(me.leadsDept.code)) {
      types.push("compras_rechazadas", "compras_transportista", "compras_cuenta_bancaria", "compras_creditos_pendientes");
    }
    if (me.canManagePurchases) types.push("deterioro_compras_gestion", "compras_excedente_gestion");
    if (me.canApprovePurchaseRequests) types.push("compras_pendientes_aprobacion", "compras_excedente_confirmar");
    if (me.leadsDept.code === "MKT") types.push("analisis_mercado_aprobacion", "analisis_mercado_sin_compra", "ventas_externas_revisar");
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
  // Confirmado 2026-09-03: además de los líderes, cualquier delegado de
  // Compras sin liderar departamento (p.ej. Jariel vía canManagePurchases)
  // también puede tener pendientes propios (ver bloque no-líder de
  // getPendingTasksForActor) — si no se incluye acá, el cron nunca lo
  // evalúa y nunca le llega el push aunque tenga algo pendiente.
  const purchaseDelegates = await prisma.user.findMany({
    where: { isActive: true, canManagePurchases: true, OR: [{ isLeader: false }, { leadsDeptId: null }] },
    select: { id: true },
  });
  return [
    { ownerId: "admin", actor: { isAdmin: true } as const },
    ...leaders.map((l) => ({ ownerId: l.id, actor: { isAdmin: false as const, userId: l.id } })),
    ...purchaseDelegates.map((l) => ({ ownerId: l.id, actor: { isAdmin: false as const, userId: l.id } })),
  ];
}
