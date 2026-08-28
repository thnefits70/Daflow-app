-- AlterTable
ALTER TABLE "MerchandiseOutflowItem" ADD COLUMN     "adminReviewedAt" TIMESTAMP(3),
ADD COLUMN     "adminReviewedById" TEXT,
ADD COLUMN     "adminReviewNote" TEXT;

-- AddForeignKey
ALTER TABLE "MerchandiseOutflowItem" ADD CONSTRAINT "MerchandiseOutflowItem_adminReviewedById_fkey" FOREIGN KEY ("adminReviewedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
