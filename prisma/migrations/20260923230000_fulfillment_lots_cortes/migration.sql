-- CreateEnum
CREATE TYPE "FulfillmentLotStatus" AS ENUM ('DRAFT', 'SENT', 'CLOSED');

-- AlterTable
ALTER TABLE "FulfillmentRequestBatch" ADD COLUMN     "lotId" TEXT;

-- AlterTable
ALTER TABLE "FulfillmentRequestItem" ADD COLUMN     "carrier" TEXT,
ADD COLUMN     "warrantyGuide" TEXT,
ADD COLUMN     "warrantyMode" TEXT,
ADD COLUMN     "warrantyPiece" TEXT;

-- CreateTable
CREATE TABLE "FulfillmentLot" (
    "id" TEXT NOT NULL,
    "day" TEXT NOT NULL,
    "corte" INTEGER NOT NULL,
    "status" "FulfillmentLotStatus" NOT NULL DEFAULT 'DRAFT',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "sentAt" TIMESTAMP(3),
    "sentById" TEXT,

    CONSTRAINT "FulfillmentLot_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "FulfillmentLot_status_idx" ON "FulfillmentLot"("status");

-- CreateIndex
CREATE UNIQUE INDEX "FulfillmentLot_day_corte_key" ON "FulfillmentLot"("day", "corte");

-- AddForeignKey
ALTER TABLE "FulfillmentRequestBatch" ADD CONSTRAINT "FulfillmentRequestBatch_lotId_fkey" FOREIGN KEY ("lotId") REFERENCES "FulfillmentLot"("id") ON DELETE SET NULL ON UPDATE CASCADE;

