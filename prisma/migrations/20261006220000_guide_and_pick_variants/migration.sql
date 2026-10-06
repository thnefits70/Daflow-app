-- AlterTable
ALTER TABLE "FulfillmentLotPick" ADD COLUMN     "variantCounts" JSONB;

-- AlterTable
ALTER TABLE "FulfillmentRequestGuide" ADD COLUMN     "labelVariants" JSONB;

