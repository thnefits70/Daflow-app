-- CreateTable
CREATE TABLE "FulfillmentLotBlock" (
    "id" TEXT NOT NULL,
    "lotId" TEXT NOT NULL,
    "carrier" TEXT NOT NULL,
    "assigneeId" TEXT NOT NULL,
    "assignedById" TEXT,
    "assignedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "FulfillmentLotBlock_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "FulfillmentLotBlock_lotId_carrier_key" ON "FulfillmentLotBlock"("lotId", "carrier");

-- AddForeignKey
ALTER TABLE "FulfillmentLotBlock" ADD CONSTRAINT "FulfillmentLotBlock_lotId_fkey" FOREIGN KEY ("lotId") REFERENCES "FulfillmentLot"("id") ON DELETE CASCADE ON UPDATE CASCADE;
