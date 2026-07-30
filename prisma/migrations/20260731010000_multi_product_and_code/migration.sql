-- AlterTable
ALTER TABLE "PurchaseCatalogItem" ADD COLUMN     "code" TEXT;

-- AlterTable
ALTER TABLE "PurchaseRequest" ADD COLUMN     "groupId" TEXT NOT NULL;

-- CreateIndex
CREATE INDEX "PurchaseRequest_groupId_idx" ON "PurchaseRequest"("groupId");
