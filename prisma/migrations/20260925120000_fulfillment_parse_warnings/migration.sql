-- AlterTable
ALTER TABLE "FulfillmentRequestBatch" ADD COLUMN     "parseWarnings" TEXT[] DEFAULT ARRAY[]::TEXT[];
