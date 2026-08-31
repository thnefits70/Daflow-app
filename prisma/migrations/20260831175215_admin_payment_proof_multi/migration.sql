-- CreateTable
CREATE TABLE "AdminPaymentProof" (
    "id" TEXT NOT NULL,
    "requestId" TEXT NOT NULL,
    "fileUrl" TEXT NOT NULL,
    "fileName" TEXT,
    "readAmount" DOUBLE PRECISION,
    "receiptNumber" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AdminPaymentProof_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "AdminPaymentProof_requestId_idx" ON "AdminPaymentProof"("requestId");

-- AddForeignKey
ALTER TABLE "AdminPaymentProof" ADD CONSTRAINT "AdminPaymentProof_requestId_fkey" FOREIGN KEY ("requestId") REFERENCES "AdminPaymentRequest"("id") ON DELETE CASCADE ON UPDATE CASCADE;

