-- CreateTable
CREATE TABLE "PayrollNairobySalaryTransfer" (
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
    "proofNumber" TEXT,
    "completedAt" TIMESTAMP(3),
    "confirmedWithoutProof" BOOLEAN NOT NULL DEFAULT false,
    "confirmedWithoutProofNote" TEXT,
    "confirmedWithoutProofAt" TIMESTAMP(3),
    "confirmedWithoutProofByName" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "PayrollNairobySalaryTransfer_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "PayrollNairobySalaryTransfer_periodId_key" ON "PayrollNairobySalaryTransfer"("periodId");

-- CreateIndex
CREATE INDEX "PayrollNairobySalaryTransfer_status_idx" ON "PayrollNairobySalaryTransfer"("status");

-- AddForeignKey
ALTER TABLE "PayrollNairobySalaryTransfer" ADD CONSTRAINT "PayrollNairobySalaryTransfer_periodId_fkey" FOREIGN KEY ("periodId") REFERENCES "PayrollPeriod"("id") ON DELETE CASCADE ON UPDATE CASCADE;

