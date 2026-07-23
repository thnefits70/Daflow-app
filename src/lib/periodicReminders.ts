// Server-only (prisma). Confirmed 2026-07-23: available to every
// department (not exclusive like Pagos recordatorios). Editing is admin OR
// that department's own leader (`canEditDeptKpis`, corrected 2026-07-23
// after the leader — Daniel, Inventario — reported he had zero access even
// to his own department's reminders); everyone else sees it read-only.
import { prisma } from "@/lib/prisma";

// Same UTC-fixed "Ecuador wall clock" trick used throughout pendingTasks.ts
// — Vercel runs in UTC, so "now" has to be shifted before any date-field
// comparison, never read via local-timezone Date methods.
const ECUADOR_UTC_OFFSET_HOURS = 5;
function nowInEcuador(): Date {
  return new Date(Date.now() - ECUADOR_UTC_OFFSET_HOURS * 3600 * 1000);
}
function pad2(n: number) {
  return String(n).padStart(2, "0");
}
function todayStr(d: Date): string {
  return `${d.getUTCFullYear()}-${pad2(d.getUTCMonth() + 1)}-${pad2(d.getUTCDate())}`;
}
function isoWeekdayOf(d: Date): number {
  return d.getUTCDay() || 7;
}
function isoWeekOf(d: Date): string {
  const date = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
  const dayNum = date.getUTCDay() || 7;
  date.setUTCDate(date.getUTCDate() + 4 - dayNum);
  const yearStart = new Date(Date.UTC(date.getUTCFullYear(), 0, 1));
  const weekNum = Math.ceil(((date.getTime() - yearStart.getTime()) / 86400000 + 1) / 7);
  return `${date.getUTCFullYear()}-W${pad2(weekNum)}`;
}

export type PeriodicReminderCompletionDTO = {
  period: string;
  completedAt: string;
  completedByName: string | null;
};

export type PeriodicReminderDTO = {
  id: string;
  title: string;
  detail: string;
  recurrence: "DAILY" | "WEEKLY" | "ONCE";
  weekday: number | null;
  date: string | null;
  timeOfDay: string | null;
  isActive: boolean;
  completions: PeriodicReminderCompletionDTO[];
};

export async function getPeriodicReminders(deptId: string): Promise<PeriodicReminderDTO[]> {
  const reminders = await prisma.periodicReminder.findMany({
    where: { deptId },
    orderBy: { order: "asc" },
    include: {
      completions: { orderBy: { completedAt: "desc" }, include: { completedBy: { select: { name: true } } } },
    },
  });

  return reminders.map((r) => ({
    id: r.id,
    title: r.title,
    detail: r.detail,
    recurrence: r.recurrence,
    weekday: r.weekday,
    date: r.date ? r.date.toISOString() : null,
    timeOfDay: r.timeOfDay,
    isActive: r.isActive,
    completions: r.completions.map((c) => ({
      period: c.period,
      completedAt: c.completedAt.toISOString(),
      completedByName: c.completedBy?.name ?? null,
    })),
  }));
}

export type DuePeriodicReminderDTO = {
  id: string;
  deptId: string;
  deptName: string;
  title: string;
  detail: string;
  recurrence: "DAILY" | "WEEKLY" | "ONCE";
  timeOfDay: string | null;
  period: string;
};

function currentPeriodFor(recurrence: "DAILY" | "WEEKLY" | "ONCE", now: Date): string {
  if (recurrence === "DAILY") return todayStr(now);
  if (recurrence === "WEEKLY") return isoWeekOf(now);
  return "once";
}

// Confirmed 2026-07-23: shown on Inicio so the person sees "what do I need
// to do right now" at a glance — only genuinely due items, not the whole
// catalog (that full list lives in the Recordatorios tab itself).
function isDueNow(r: { recurrence: "DAILY" | "WEEKLY" | "ONCE"; weekday: number | null; date: Date | null; timeOfDay: string | null }, now: Date): boolean {
  if (r.recurrence === "ONCE") {
    if (!r.date) return false;
    const dueAt = new Date(Date.UTC(r.date.getUTCFullYear(), r.date.getUTCMonth(), r.date.getUTCDate()));
    if (r.timeOfDay) {
      const [h, m] = r.timeOfDay.split(":").map(Number);
      dueAt.setUTCHours(h, m, 0, 0);
    }
    return now >= dueAt;
  }
  if (r.recurrence === "WEEKLY") {
    const todayWd = isoWeekdayOf(now);
    if (r.weekday == null) return true;
    if (todayWd < r.weekday) return false;
    if (todayWd > r.weekday) return true;
    if (!r.timeOfDay) return true;
    const [h, m] = r.timeOfDay.split(":").map(Number);
    const t = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate(), h, m));
    return now >= t;
  }
  // DAILY
  if (!r.timeOfDay) return true;
  const [h, m] = r.timeOfDay.split(":").map(Number);
  const t = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate(), h, m));
  return now >= t;
}

// `scope: "all"` for admin (every department); `{ deptId }` for an
// employee/leader (their own department only).
export async function getDuePeriodicReminders(scope: { deptId: string } | "all"): Promise<DuePeriodicReminderDTO[]> {
  const reminders = await prisma.periodicReminder.findMany({
    where: scope === "all" ? { isActive: true } : { isActive: true, deptId: scope.deptId },
    include: { department: { select: { name: true } }, completions: { select: { period: true } } },
    orderBy: { order: "asc" },
  });

  const now = nowInEcuador();
  const due: DuePeriodicReminderDTO[] = [];
  for (const r of reminders) {
    const period = currentPeriodFor(r.recurrence, now);
    if (r.completions.some((c) => c.period === period)) continue;
    if (!isDueNow(r, now)) continue;
    due.push({
      id: r.id,
      deptId: r.deptId,
      deptName: r.department.name,
      title: r.title,
      detail: r.detail,
      recurrence: r.recurrence,
      timeOfDay: r.timeOfDay,
      period,
    });
  }
  return due;
}
