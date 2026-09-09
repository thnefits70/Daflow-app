-- AlterTable
ALTER TABLE "PayrollProfile" ADD COLUMN     "externalPaymentMode" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "requiresInvoice" BOOLEAN NOT NULL DEFAULT false;

-- CreateTable
CREATE TABLE "ExternalPayment" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "month" TEXT NOT NULL,
    "amount" DOUBLE PRECISION NOT NULL,
    "paidAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "receiptUrl" TEXT NOT NULL,
    "receiptFileName" TEXT NOT NULL,
    "invoiceUrl" TEXT,
    "invoiceFileName" TEXT,
    "invoiceNumber" TEXT,
    "registeredById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ExternalPayment_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "ExternalPayment_userId_idx" ON "ExternalPayment"("userId");

-- CreateIndex
CREATE UNIQUE INDEX "ExternalPayment_userId_month_key" ON "ExternalPayment"("userId", "month");

-- AddForeignKey
ALTER TABLE "ExternalPayment" ADD CONSTRAINT "ExternalPayment_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ExternalPayment" ADD CONSTRAINT "ExternalPayment_registeredById_fkey" FOREIGN KEY ("registeredById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

