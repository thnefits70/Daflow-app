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
  createdById: string | null;
  createdByName: string | null;
  notifyPush: boolean;
  completions: PeriodicReminderCompletionDTO[];
};

// Confirmado 2026-08-05: los recordatorios son estrictamente PERSONALES — ni
// siquiera el líder o el admin ven los de otro compañero, aunque sean del
// mismo departamento. viewerId es el id de quien está viendo (null = admin,
// mismo sentinela que createdById en la creación).
export async function getPeriodicReminders(deptId: string, viewerId: string | null): Promise<PeriodicReminderDTO[]> {
  const reminders = await prisma.periodicReminder.findMany({
    where: { deptId, createdById: viewerId },
    orderBy: { order: "asc" },
    include: {
      createdBy: { select: { name: true } },
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
    createdById: r.createdById,
    createdByName: r.createdById ? (r.createdBy?.name ?? null) : "Admin",
    notifyPush: r.notifyPush,
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

// Fix confirmado 2026-08-06: el cron de push corre UNA sola vez al día
// (08:00 hora Ecuador) — isDueNow() comparaba contra timeOfDay incluso ahí,
// así que cualquier recordatorio DIARIO con una hora configurada DESPUÉS de
// las 8am nunca se consideraba "due" en esa única corrida, todos los días,
// para siempre (WEEKLY/ONCE se autocorregían al día siguiente por su lógica
// de "ya pasó el día objetivo", pero DIARIO reinicia el período cada día y
// repetía el mismo bloqueo). Para decidir si hay que EMPUJAR una notificación
// se ignora la hora por completo — ya no hay forma de respetarla con un solo
// chequeo diario, así que se avisa en cuanto el período esté vigente y no
// se haya marcado como hecho, tal como ya prometía el comentario de abajo.
function isDueForPush(r: { recurrence: "DAILY" | "WEEKLY" | "ONCE"; weekday: number | null; date: Date | null }, now: Date): boolean {
  if (r.recurrence === "ONCE") {
    if (!r.date) return false;
    const dueDate = new Date(Date.UTC(r.date.getUTCFullYear(), r.date.getUTCMonth(), r.date.getUTCDate()));
    const today = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
    return today >= dueDate;
  }
  if (r.recurrence === "WEEKLY") {
    if (r.weekday == null) return true;
    return isoWeekdayOf(now) >= r.weekday;
  }
  return true; // DAILY
}

// Estrictamente personal (confirmado 2026-08-05) — solo lo que ESTA persona
// creó, nunca lo de un compañero del mismo departamento. userId null = admin.
export async function getDuePeriodicReminders(scope: { deptId: string; userId: string | null }): Promise<DuePeriodicReminderDTO[]> {
  const reminders = await prisma.periodicReminder.findMany({
    where: { isActive: true, deptId: scope.deptId, createdById: scope.userId },
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

export type PersonalReminderPushDTO = { ownerId: string; title: string; body: string; url: string };

// Confirmado 2026-07-28: notificación push por recordatorio individual — a
// diferencia de "Pendientes" (categorías fijas), aquí cada persona decide
// por su propio recordatorio si quiere que le avise (notifyPush). Solo se
// arma UNA vez al día (ver limitación del cron en el comentario de
// /api/cron/push-pendientes) — no respeta la hora exacta configurada
// (timeOfDay), solo si el recordatorio ya está "due" hoy y no se ha
// marcado como hecho todavía.
export async function getDuePersonalReminderPushes(): Promise<PersonalReminderPushDTO[]> {
  const reminders = await prisma.periodicReminder.findMany({
    where: { isActive: true, notifyPush: true },
    include: { completions: { select: { period: true } } },
  });

  const now = nowInEcuador();
  const out: PersonalReminderPushDTO[] = [];
  for (const r of reminders) {
    const period = currentPeriodFor(r.recurrence, now);
    if (r.completions.some((c) => c.period === period)) continue;
    if (!isDueForPush(r, now)) continue;
    const ownerId = r.createdById ?? "admin";
    const url = ownerId === "admin" ? `/admin/dept/${r.deptId}` : "/area/workspace";
    out.push({ ownerId, title: `DAFLOW · Recordatorio`, body: r.title, url });
  }
  return out;
}
