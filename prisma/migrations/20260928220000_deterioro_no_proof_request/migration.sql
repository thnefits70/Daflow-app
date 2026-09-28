-- AlterTable
ALTER TABLE "MerchandiseOutflowItem" ADD COLUMN     "noProofAmount" DOUBLE PRECISION,
ADD COLUMN     "noProofApproved" BOOLEAN,
ADD COLUMN     "noProofDecidedAt" TIMESTAMP(3),
ADD COLUMN     "noProofDecidedById" TEXT,
ADD COLUMN     "noProofDecisionNote" TEXT,
ADD COLUMN     "noProofNote" TEXT,
ADD COLUMN     "noProofRequestedAt" TIMESTAMP(3),
ADD COLUMN     "noProofRequestedById" TEXT,
ADD COLUMN     "noProofResolution" "OutflowItemResolution";

-- AddForeignKey
ALTER TABLE "MerchandiseOutflowItem" ADD CONSTRAINT "MerchandiseOutflowItem_noProofRequestedById_fkey" FOREIGN KEY ("noProofRequestedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
