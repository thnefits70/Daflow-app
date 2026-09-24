-- AlterTable
ALTER TABLE "FulfillmentLot" ADD COLUMN     "closedAt" TIMESTAMP(3),
ADD COLUMN     "despachoOutflowBatchId" TEXT,
ADD COLUMN     "garantiaOutflowBatchId" TEXT;

-- AlterTable
ALTER TABLE "FulfillmentRequestItem" ADD COLUMN     "pieceConfirmedAt" TIMESTAMP(3),
ADD COLUMN     "pieceConfirmedById" TEXT;

-- CreateTable
CREATE TABLE "FulfillmentLotPick" (
    "id" TEXT NOT NULL,
    "lotId" TEXT NOT NULL,
    "catalogItemId" TEXT NOT NULL,
    "pickedQty" INTEGER NOT NULL,
    "pickedById" TEXT,
    "pickedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "confirmedQty" INTEGER,
    "confirmedAt" TIMESTAMP(3),
    "confirmedById" TEXT,

    CONSTRAINT "FulfillmentLotPick_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "FulfillmentLotPick_lotId_catalogItemId_key" ON "FulfillmentLotPick"("lotId", "catalogItemId");

-- CreateIndex
CREATE UNIQUE INDEX "FulfillmentLot_despachoOutflowBatchId_key" ON "FulfillmentLot"("despachoOutflowBatchId");

-- CreateIndex
CREATE UNIQUE INDEX "FulfillmentLot_garantiaOutflowBatchId_key" ON "FulfillmentLot"("garantiaOutflowBatchId");

-- AddForeignKey
ALTER TABLE "FulfillmentLotPick" ADD CONSTRAINT "FulfillmentLotPick_lotId_fkey" FOREIGN KEY ("lotId") REFERENCES "FulfillmentLot"("id") ON DELETE CASCADE ON UPDATE CASCADE;
