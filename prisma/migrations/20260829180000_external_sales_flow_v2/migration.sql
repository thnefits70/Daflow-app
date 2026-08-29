-- AlterTable
ALTER TABLE "ExternalSale" ADD COLUMN     "invoiceName" TEXT,
ADD COLUMN     "invoiceUploadedAt" TIMESTAMP(3),
ADD COLUMN     "invoiceUploadedById" TEXT,
ADD COLUMN     "invoiceUrl" TEXT,
ADD COLUMN     "isContraEntrega" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "packAssignedAt" TIMESTAMP(3),
ADD COLUMN     "packAssignedById" TEXT,
ADD COLUMN     "packAssignedToId" TEXT,
ADD COLUMN     "prepPhotoUrl" TEXT,
ADD COLUMN     "prepReadyAt" TIMESTAMP(3),
ADD COLUMN     "prepReadyById" TEXT;

-- AlterTable
ALTER TABLE "User" ADD COLUMN     "externalSaleContraEntrega" BOOLEAN NOT NULL DEFAULT false;

-- CreateIndex
CREATE INDEX "ExternalSale_packAssignedToId_idx" ON "ExternalSale"("packAssignedToId");

-- AddForeignKey
ALTER TABLE "ExternalSale" ADD CONSTRAINT "ExternalSale_invoiceUploadedById_fkey" FOREIGN KEY ("invoiceUploadedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ExternalSale" ADD CONSTRAINT "ExternalSale_prepReadyById_fkey" FOREIGN KEY ("prepReadyById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ExternalSale" ADD CONSTRAINT "ExternalSale_packAssignedToId_fkey" FOREIGN KEY ("packAssignedToId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ExternalSale" ADD CONSTRAINT "ExternalSale_packAssignedById_fkey" FOREIGN KEY ("packAssignedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

