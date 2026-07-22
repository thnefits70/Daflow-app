import { auth } from "@/auth";
import { prisma } from "@/lib/prisma";

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

function nextMonthStr(month: string): string {
  const [y, m] = month.split("-").map(Number);
  const d = new Date(Date.UTC(y, m, 1));
  return `${d.getUTCFullYear()}-${pad2(d.getUTCMonth() + 1)}`;
}

function firstMondayOfMonth(month: string): Date {
  const [y, m] = month.split("-").map(Number);
  const d = new Date(Date.UTC(y, m - 1, 1));
  const day = d.getUTCDay() || 7;
  const offset = day === 1 ? 0 : 8 - day;
  d.setUTCDate(d.getUTCDate() + offset);
  return d;
}

function monthDeadlinePassed(month: string): boolean {
  // Deadline for `month`'s data = first Monday of the following month.
  const deadline = firstMondayOfMonth(nextMonthStr(month));
  return nowInEcuador() >= deadline;
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

async function monthlyPendingStatus(
  exists: (month: string) => Promise<boolean>
): Promise<{ month: string; overdue: boolean } | null> {
  const today = currentMonthStr();
  const prev = prevMonthStr(today);
  if (monthDeadlinePassed(prev) && !(await exists(prev))) return { month: prev, overdue: true };
  return null;
}

// ---------------- Public types ----------------
export type PendingItem = {
  icon: string;
  label: string;
  meta: string;
  overdue: boolean;
  href: string;
};

export type PendingTasks = { title: string; sub: string; items: PendingItem[] };

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
    const status = await weeklyPendingStatus(async (week) => {
      const count = await prisma.weeklyReviewRecord.count({ where: { deptId: d.id, week } });
      return count > 0;
    }, FEEDBACK_REVIEW_WEEKDAY[d.code] ?? 1);
    if (status) {
      items.push({
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

// Same rule as weekly/monthlyPendingStatus: only surfaces once the previous
// month's deadline has actually passed and people are still missing — no
// early heads-up for the current, still-in-progress month.
async function getPayStubPendingItem(href: string): Promise<PendingItem | null> {
  const today = currentMonthStr();
  const prev = prevMonthStr(today);

  if (monthDeadlinePassed(prev)) {
    const [py, pm] = prev.split("-").map(Number);
    const missing = await countMissingPayStubs(pm, py);
    if (missing > 0) {
      return {
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

async function getReturnRatePendingItem(href: string): Promise<PendingItem | null> {
  const status = await monthlyPendingStatus(async (month) => !!(await prisma.returnRateRecord.findUnique({ where: { month } })));
  if (!status) return null;
  return {
    icon: "📉",
    label: "Tasa de Devolución General",
    meta: `${formatMonthLabel(status.month)} · atrasado`,
    overdue: status.overdue,
    href,
  };
}

async function getWarrantyPendingItem(href: string): Promise<PendingItem | null> {
  const status = await monthlyPendingStatus(async (month) => !!(await prisma.warrantyMonthTotal.findUnique({ where: { month } })));
  if (!status) return null;
  return {
    icon: "🛡️",
    label: "KPI de Garantías",
    meta: `${formatMonthLabel(status.month)} · atrasado`,
    overdue: status.overdue,
    href,
  };
}

// ---------------- Entry point ----------------
// Each person only ever sees what's specifically assigned to them — admin
// gets Feedback semanal (the one thing only admin can write), a department
// leader gets whichever of Roles de pago/Devolución/Garantías (Finanzas),
// Pedidos despachados (whoever leads the trackWeeklyMetric department), or
// Ruptura de Stock (Inventario) applies to them. Nobody sees anyone else's.
export async function getPendingTasksForCurrentUser(): Promise<PendingTasks | null> {
  const session = await auth();
  if (!session) return null;

  if (session.user.role === "admin") {
    const items = await getFeedbackPendingItems();
    if (items.length === 0) return null;
    return { title: "Pendientes de esta semana", sub: "Como administrador", items };
  }

  const me = await prisma.user.findUnique({
    where: { id: session.user.id },
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
    const [payStub, returnRate, warranty] = await Promise.all([
      getPayStubPendingItem("/area/roles-de-pago"),
      getReturnRatePendingItem("/area/kpis-generales"),
      getWarrantyPendingItem("/area/kpis-generales"),
    ]);
    if (payStub) items.push(payStub);
    if (returnRate) items.push(returnRate);
    if (warranty) items.push(warranty);
  }

  if (me.leadsDept.trackWeeklyMetric) {
    const item = await getWeeklyMetricPendingItem(me.leadsDeptId, "/area/workspace");
    if (item) items.push(item);
  }

  if (me.leadsDept.code === "INV") {
    const item = await getStockoutPendingItem("/area/kpis-generales");
    if (item) items.push(item);
  }

  if (items.length === 0) return null;
  return {
    title: monthly ? "Pendientes de este mes" : "Pendientes de esta semana",
    sub: `Como líder de ${me.leadsDept.name}`,
    items,
  };
}
