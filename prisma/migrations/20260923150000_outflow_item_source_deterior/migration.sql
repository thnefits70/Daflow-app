-- AlterTable
ALTER TABLE "MerchandiseOutflowItem" ADD COLUMN     "sourceDeteriorItemId" TEXT;

-- CreateIndex
CREATE UNIQUE INDEX "MerchandiseOutflowItem_sourceDeteriorItemId_key" ON "MerchandiseOutflowItem"("sourceDeteriorItemId");

-- AddForeignKey
ALTER TABLE "MerchandiseOutflowItem" ADD CONSTRAINT "MerchandiseOutflowItem_sourceDeteriorItemId_fkey" FOREIGN KEY ("sourceDeteriorItemId") REFERENCES "MerchandiseOutflowItem"("id") ON DELETE SET NULL ON UPDATE CASCADE;
