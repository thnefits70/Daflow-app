
-- AlterTable
ALTER TABLE "MerchandiseReentryItem" ADD COLUMN     "supplierClaimAt" TIMESTAMP(3),
ADD COLUMN     "supplierClaimById" TEXT;

-- AlterTable
ALTER TABLE "MerchandiseOutflowItem" ADD COLUMN     "replacementReceivedAt" TIMESTAMP(3),
ADD COLUMN     "sourceReentryItemId" TEXT;

-- CreateTable
CREATE TABLE "MerchandiseReplacementReceipt" (
    "id" TEXT NOT NULL,
    "outflowItemId" TEXT NOT NULL,
    "quantity" INTEGER NOT NULL,
    "photoUrls" TEXT[],
    "note" TEXT,
    "receivedById" TEXT,
    "receivedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "MerchandiseReplacementReceipt_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "MerchandiseReplacementReceipt_outflowItemId_idx" ON "MerchandiseReplacementReceipt"("outflowItemId");

-- CreateIndex
CREATE UNIQUE INDEX "MerchandiseOutflowItem_sourceReentryItemId_key" ON "MerchandiseOutflowItem"("sourceReentryItemId");

-- AddForeignKey
ALTER TABLE "MerchandiseReentryItem" ADD CONSTRAINT "MerchandiseReentryItem_supplierClaimById_fkey" FOREIGN KEY ("supplierClaimById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MerchandiseOutflowItem" ADD CONSTRAINT "MerchandiseOutflowItem_sourceReentryItemId_fkey" FOREIGN KEY ("sourceReentryItemId") REFERENCES "MerchandiseReentryItem"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MerchandiseReplacementReceipt" ADD CONSTRAINT "MerchandiseReplacementReceipt_outflowItemId_fkey" FOREIGN KEY ("outflowItemId") REFERENCES "MerchandiseOutflowItem"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MerchandiseReplacementReceipt" ADD CONSTRAINT "MerchandiseReplacementReceipt_receivedById_fkey" FOREIGN KEY ("receivedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

