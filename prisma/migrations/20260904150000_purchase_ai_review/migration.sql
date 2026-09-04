-- AlterTable
ALTER TABLE "PurchaseRequest" ADD COLUMN     "aiReviewAt" TIMESTAMP(3),
ADD COLUMN     "aiReviewOk" BOOLEAN,
ADD COLUMN     "aiReviewSummary" TEXT;
