-- CreateEnum
CREATE TYPE "PeriodicReminderRecurrence" AS ENUM ('DAILY', 'WEEKLY', 'ONCE');

-- CreateTable
CREATE TABLE "PeriodicReminder" (
    "id" TEXT NOT NULL,
    "deptId" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "detail" TEXT NOT NULL DEFAULT '',
    "recurrence" "PeriodicReminderRecurrence" NOT NULL,
    "weekday" INTEGER,
    "date" TIMESTAMP(3),
    "timeOfDay" TEXT,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "order" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PeriodicReminder_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PeriodicReminderCompletion" (
    "id" TEXT NOT NULL,
    "reminderId" TEXT NOT NULL,
    "period" TEXT NOT NULL,
    "completedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "completedById" TEXT,

    CONSTRAINT "PeriodicReminderCompletion_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "PeriodicReminder_deptId_idx" ON "PeriodicReminder"("deptId");

-- CreateIndex
CREATE INDEX "PeriodicReminderCompletion_reminderId_idx" ON "PeriodicReminderCompletion"("reminderId");

-- CreateIndex
CREATE UNIQUE INDEX "PeriodicReminderCompletion_reminderId_period_key" ON "PeriodicReminderCompletion"("reminderId", "period");

-- AddForeignKey
ALTER TABLE "PeriodicReminder" ADD CONSTRAINT "PeriodicReminder_deptId_fkey" FOREIGN KEY ("deptId") REFERENCES "Department"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PeriodicReminderCompletion" ADD CONSTRAINT "PeriodicReminderCompletion_reminderId_fkey" FOREIGN KEY ("reminderId") REFERENCES "PeriodicReminder"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PeriodicReminderCompletion" ADD CONSTRAINT "PeriodicReminderCompletion_completedById_fkey" FOREIGN KEY ("completedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
