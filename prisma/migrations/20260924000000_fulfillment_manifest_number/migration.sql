-- AlterTable
ALTER TABLE "FulfillmentLot" ADD COLUMN     "manifestNumber" INTEGER,
ADD COLUMN     "printedAt" TIMESTAMP(3),
ADD COLUMN     "printedById" TEXT;

-- CreateIndex
CREATE UNIQUE INDEX "FulfillmentLot_manifestNumber_key" ON "FulfillmentLot"("manifestNumber");

