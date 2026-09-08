-- CreateTable
CREATE TABLE "LunchWeekSubmission" (
    "id" TEXT NOT NULL,
    "weekStart" TIMESTAMP(3) NOT NULL,
    "weekEnd" TIMESTAMP(3) NOT NULL,
    "lunchCount" INTEGER NOT NULL,
    "monto" DOUBLE PRECISION NOT NULL,
    "payeeId" TEXT,
    "bankAccountId" TEXT,
    "registeredById" TEXT,
    "registeredAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "invoiceConfirmedAt" TIMESTAMP(3),
    "invoiceConfirmedById" TEXT,
    "sentToVerificationAt" TIMESTAMP(3),
    "verifiedAt" TIMESTAMP(3),
    "verifiedById" TEXT,
    "adminPaymentRequestId" TEXT,

    CONSTRAINT "LunchWeekSubmission_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "LunchWeekSubmission_adminPaymentRequestId_key" ON "LunchWeekSubmission"("adminPaymentRequestId");

-- CreateIndex
CREATE INDEX "LunchWeekSubmission_sentToVerificationAt_idx" ON "LunchWeekSubmission"("sentToVerificationAt");

-- CreateIndex
CREATE UNIQUE INDEX "LunchWeekSubmission_weekStart_weekEnd_key" ON "LunchWeekSubmission"("weekStart", "weekEnd");

-- AddForeignKey
ALTER TABLE "LunchWeekSubmission" ADD CONSTRAINT "LunchWeekSubmission_payeeId_fkey" FOREIGN KEY ("payeeId") REFERENCES "AdminPaymentPayee"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LunchWeekSubmission" ADD CONSTRAINT "LunchWeekSubmission_bankAccountId_fkey" FOREIGN KEY ("bankAccountId") REFERENCES "AdminPaymentPayeeBankAccount"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LunchWeekSubmission" ADD CONSTRAINT "LunchWeekSubmission_registeredById_fkey" FOREIGN KEY ("registeredById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LunchWeekSubmission" ADD CONSTRAINT "LunchWeekSubmission_invoiceConfirmedById_fkey" FOREIGN KEY ("invoiceConfirmedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LunchWeekSubmission" ADD CONSTRAINT "LunchWeekSubmission_verifiedById_fkey" FOREIGN KEY ("verifiedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LunchWeekSubmission" ADD CONSTRAINT "LunchWeekSubmission_adminPaymentRequestId_fkey" FOREIGN KEY ("adminPaymentRequestId") REFERENCES "AdminPaymentRequest"("id") ON DELETE SET NULL ON UPDATE CASCADE;

