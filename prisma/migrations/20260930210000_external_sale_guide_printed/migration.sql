ALTER TABLE "ExternalSale" ADD COLUMN "guidePrintedAt" TIMESTAMP(3), ADD COLUMN "guidePrintedById" TEXT;
ALTER TABLE "ExternalSale" ADD CONSTRAINT "ExternalSale_guidePrintedById_fkey" FOREIGN KEY ("guidePrintedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
