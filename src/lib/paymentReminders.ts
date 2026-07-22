// Server-only (prisma). No reference/expected amount is ever stored on the
// reminder itself — confirmed 2026-07-22: amounts vary every month, so the
// real amount is entered manually each time it's marked "Realizado"
// (PaymentReminderRecord.amountPaid), never pre-filled.
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
