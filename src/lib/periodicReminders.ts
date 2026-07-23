// Server-only (prisma). Confirmed 2026-07-23: available to every
// department (not exclusive like Pagos recordatorios), same permission tier
// as Procesos/Documentos/Exámenes — admin creates/edits, the leader only
// sees them read-only.
import { prisma } from "@/lib/prisma";

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
