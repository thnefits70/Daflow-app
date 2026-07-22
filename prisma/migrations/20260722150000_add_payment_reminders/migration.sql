-- AlterTable
ALTER TABLE "Department" ADD COLUMN     "trackPaymentReminders" BOOLEAN NOT NULL DEFAULT false;

-- CreateTable
CREATE TABLE "PaymentReminder" (
    "id" TEXT NOT NULL,
    "deptId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "paymentMethod" TEXT,
    "dueDay" INTEGER NOT NULL,
    "reminderStartDay" INTEGER NOT NULL,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "order" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PaymentReminder_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PaymentReminderRecord" (
    "id" TEXT NOT NULL,
    "reminderId" TEXT NOT NULL,
    "period" TEXT NOT NULL,
    "amountPaid" DOUBLE PRECISION NOT NULL,
    "completedById" TEXT,
    "completedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PaymentReminderRecord_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "PaymentReminder_deptId_idx" ON "PaymentReminder"("deptId");

-- CreateIndex
CREATE INDEX "PaymentReminderRecord_reminderId_idx" ON "PaymentReminderRecord"("reminderId");

-- CreateIndex
CREATE UNIQUE INDEX "PaymentReminderRecord_reminderId_period_key" ON "PaymentReminderRecord"("reminderId", "period");

-- AddForeignKey
ALTER TABLE "PaymentReminder" ADD CONSTRAINT "PaymentReminder_deptId_fkey" FOREIGN KEY ("deptId") REFERENCES "Department"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PaymentReminderRecord" ADD CONSTRAINT "PaymentReminderRecord_reminderId_fkey" FOREIGN KEY ("reminderId") REFERENCES "PaymentReminder"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PaymentReminderRecord" ADD CONSTRAINT "PaymentReminderRecord_completedById_fkey" FOREIGN KEY ("completedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
