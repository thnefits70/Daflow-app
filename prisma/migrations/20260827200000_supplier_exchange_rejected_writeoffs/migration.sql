-- AlterEnum
ALTER TYPE "OutflowItemResolution" ADD VALUE 'REJECTED';

-- AlterTable
ALTER TABLE "MerchandiseOutflowItem" ADD COLUMN     "financeWriteOffAt" TIMESTAMP(3),
ADD COLUMN     "financeWriteOffById" TEXT,
ADD COLUMN     "justWriteOffConfirmedAt" TIMESTAMP(3),
ADD COLUMN     "justWriteOffConfirmedById" TEXT;

-- AddForeignKey
ALTER TABLE "MerchandiseOutflowItem" ADD CONSTRAINT "MerchandiseOutflowItem_financeWriteOffById_fkey" FOREIGN KEY ("financeWriteOffById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MerchandiseOutflowItem" ADD CONSTRAINT "MerchandiseOutflowItem_justWriteOffConfirmedById_fkey" FOREIGN KEY ("justWriteOffConfirmedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

