-- AlterTable
ALTER TABLE "ExternalSale" ADD COLUMN     "returnConfirmedAt" TIMESTAMP(3),
ADD COLUMN     "returnConfirmedById" TEXT,
ADD COLUMN     "returnReceivedAt" TIMESTAMP(3),
ADD COLUMN     "returnReceivedById" TEXT,
ADD COLUMN     "returnReceivedNote" TEXT;

-- AddForeignKey
ALTER TABLE "ExternalSale" ADD CONSTRAINT "ExternalSale_returnReceivedById_fkey" FOREIGN KEY ("returnReceivedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ExternalSale" ADD CONSTRAINT "ExternalSale_returnConfirmedById_fkey" FOREIGN KEY ("returnConfirmedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

