-- AlterEnum
ALTER TYPE "StockMovementType" ADD VALUE 'COST_DECLARATION';

-- AlterTable
ALTER TABLE "StockKardexEntry" ADD COLUMN     "declaredCostById" TEXT;

-- AddForeignKey
ALTER TABLE "StockKardexEntry" ADD CONSTRAINT "StockKardexEntry_declaredCostById_fkey" FOREIGN KEY ("declaredCostById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

