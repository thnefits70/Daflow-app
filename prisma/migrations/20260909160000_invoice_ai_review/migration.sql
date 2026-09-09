-- AlterTable
ALTER TABLE "PurchaseRequest" ADD COLUMN     "aiInvoiceReviewSummary" TEXT,
ADD COLUMN     "aiInvoiceReviewOk" BOOLEAN,
ADD COLUMN     "aiInvoiceReviewAt" TIMESTAMP(3);
