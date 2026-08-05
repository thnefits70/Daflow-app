-- AlterTable
ALTER TABLE "PettyCashBox" ADD COLUMN "lastRequestNumber" INTEGER NOT NULL DEFAULT 0;

-- AlterTable
ALTER TABLE "PettyCashEntry" ADD COLUMN "requestNumber" INTEGER NOT NULL;

-- CreateIndex
CREATE UNIQUE INDEX "PettyCashEntry_boxId_requestNumber_key" ON "PettyCashEntry"("boxId", "requestNumber");
