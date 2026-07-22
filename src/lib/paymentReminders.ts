// Server-only (prisma). Each reminder keeps a persistent reference amount
// (confirmed 2026-07-22) — it stays the same month to month unless someone
// deliberately edits it (a real price change), and pre-fills the "Realizado"
// amount without forcing it: the actual PaymentReminderRecord.amountPaid can
// still be adjusted for a one-off month without touching the reference.
import { prisma } from "@/lib/prisma";

export type PaymentReminderRecordDTO = {
  period: string;
  amountPaid: number;
  completedAt: string;
  completedByName: string | null;
};

export type PaymentReminderDTO = {
  id: string;
  name: string;
  amount: number | null;
  paymentMethod: string | null;
  dueDay: number;
  reminderStartDay: number;
  isActive: boolean;
  records: PaymentReminderRecordDTO[];
};

export async function getPaymentRemindersData(deptId: string): Promise<PaymentReminderDTO[]> {
  const reminders = await prisma.paymentReminder.findMany({
    where: { deptId },
    orderBy: { order: "asc" },
    include: {
      records: { orderBy: { period: "desc" }, include: { completedBy: { select: { name: true } } } },
    },
  });

  return reminders.map((r) => ({
    id: r.id,
    name: r.name,
    amount: r.amount,
    paymentMethod: r.paymentMethod,
    dueDay: r.dueDay,
    reminderStartDay: r.reminderStartDay,
    isActive: r.isActive,
    records: r.records.map((rec) => ({
      period: rec.period,
      amountPaid: rec.amountPaid,
      completedAt: rec.completedAt.toISOString(),
      completedByName: rec.completedBy?.name ?? null,
    })),
  }));
}
