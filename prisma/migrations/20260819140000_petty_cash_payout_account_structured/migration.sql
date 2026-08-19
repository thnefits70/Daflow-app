-- AlterTable
ALTER TABLE "PettyCashBox" DROP COLUMN "payoutAccount";

-- CreateTable
CREATE TABLE "PettyCashPayoutAccount" (
    "id" TEXT NOT NULL,
    "boxId" TEXT NOT NULL,
    "bankName" TEXT NOT NULL,
    "bankAccountType" TEXT NOT NULL,
    "bankAccountNumber" TEXT NOT NULL,
    "bankAccountHolder" TEXT NOT NULL,
    "holderIdType" "HolderIdType",
    "holderIdNumber" TEXT,
    "email" TEXT,
    "phone" TEXT,
    "updatedById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "PettyCashPayoutAccount_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "PettyCashPayoutAccount_boxId_key" ON "PettyCashPayoutAccount"("boxId");

-- AddForeignKey
ALTER TABLE "PettyCashPayoutAccount" ADD CONSTRAINT "PettyCashPayoutAccount_boxId_fkey" FOREIGN KEY ("boxId") REFERENCES "PettyCashBox"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PettyCashPayoutAccount" ADD CONSTRAINT "PettyCashPayoutAccount_updatedById_fkey" FOREIGN KEY ("updatedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
