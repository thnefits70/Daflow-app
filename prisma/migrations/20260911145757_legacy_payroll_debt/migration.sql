-- CreateTable
CREATE TABLE "LegacyPayrollDebt" (
    "id" TEXT NOT NULL,
    "employeeId" TEXT NOT NULL,
    "totalAmount" DOUBLE PRECISION NOT NULL,
    "reason" TEXT NOT NULL,
    "installments" INTEGER NOT NULL DEFAULT 1,
    "firstPayoutMonth" TEXT NOT NULL,
    "createdById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "LegacyPayrollDebt_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "LegacyPayrollDebt_employeeId_idx" ON "LegacyPayrollDebt"("employeeId");

-- AddForeignKey
ALTER TABLE "LegacyPayrollDebt" ADD CONSTRAINT "LegacyPayrollDebt_employeeId_fkey" FOREIGN KEY ("employeeId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

