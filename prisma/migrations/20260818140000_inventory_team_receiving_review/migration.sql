-- AlterEnum
ALTER TYPE "PurchaseRequestStatus" ADD VALUE 'RECEIVED_PENDING_REVIEW';

-- AlterTable
ALTER TABLE "PurchaseRequestReceipt" ADD COLUMN     "approvedAt" TIMESTAMP(3),
ADD COLUMN     "approvedById" TEXT,
ADD COLUMN     "videoUrls" TEXT[] DEFAULT ARRAY[]::TEXT[];

-- AlterTable
ALTER TABLE "PurchaseRequestUrgentReport" ADD COLUMN     "reviewedByLeadAt" TIMESTAMP(3),
ADD COLUMN     "reviewedByLeadId" TEXT,
ALTER COLUMN "mediaUrls" DROP DEFAULT;

-- AlterTable
ALTER TABLE "PurchaseUrgentResolution" ALTER COLUMN "replacementPhotoUrls" DROP DEFAULT;

-- AddForeignKey
ALTER TABLE "PurchaseRequestReceipt" ADD CONSTRAINT "PurchaseRequestReceipt_approvedById_fkey" FOREIGN KEY ("approvedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PurchaseRequestUrgentReport" ADD CONSTRAINT "PurchaseRequestUrgentReport_reviewedByLeadId_fkey" FOREIGN KEY ("reviewedByLeadId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

