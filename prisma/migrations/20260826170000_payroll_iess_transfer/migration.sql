-- CreateTable
CREATE TABLE "PayrollIessTransfer" (
    "id" TEXT NOT NULL,
    "periodId" TEXT NOT NULL,
    "totalAmount" DOUBLE PRECISION NOT NULL,
    "destination" "PayrollTransferDestination" NOT NULL,
    "status" "PayrollTransferStatus" NOT NULL DEFAULT 'PENDING_APPROVAL',
    "rejectionReason" TEXT,
    "rejectedAt" TIMESTAMP(3),
    "approvedAt" TIMESTAMP(3),
    "proofUrl" TEXT,
    "proofName" TEXT,
    "completedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "PayrollIessTransfer_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "PayrollIessTransfer_periodId_key" ON "PayrollIessTransfer"("periodId");

-- CreateIndex
CREATE INDEX "PayrollIessTransfer_status_idx" ON "PayrollIessTransfer"("status");

-- AddForeignKey
ALTER TABLE "PayrollIessTransfer" ADD CONSTRAINT "PayrollIessTransfer_periodId_fkey" FOREIGN KEY ("periodId") REFERENCES "PayrollPeriod"("id") ON DELETE CASCADE ON UPDATE CASCADE;
