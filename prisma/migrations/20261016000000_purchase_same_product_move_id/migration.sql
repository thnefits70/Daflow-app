-- AlterTable
ALTER TABLE "PurchaseRequest" ADD COLUMN     "movedFromItemName" TEXT,
ADD COLUMN     "movedFromJustCode" TEXT,
ADD COLUMN     "movedToOtherIdAt" TIMESTAMP(3),
ADD COLUMN     "movedToOtherIdById" TEXT,
ADD COLUMN     "sameProductConfirmedAt" TIMESTAMP(3);

-- AddForeignKey
ALTER TABLE "PurchaseRequest" ADD CONSTRAINT "PurchaseRequest_movedToOtherIdById_fkey" FOREIGN KEY ("movedToOtherIdById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

