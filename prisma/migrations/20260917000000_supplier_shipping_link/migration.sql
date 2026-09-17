-- AlterTable
ALTER TABLE "Supplier" ADD COLUMN     "publicShippingToken" TEXT,
ADD COLUMN     "publicShippingTokenCreatedAt" TIMESTAMP(3);

-- CreateIndex
CREATE UNIQUE INDEX "Supplier_publicShippingToken_key" ON "Supplier"("publicShippingToken");
