-- AlterTable
ALTER TABLE "Store" ADD COLUMN     "brand" TEXT;

-- AlterTable
ALTER TABLE "StoreFeedbackEvaluation" DROP COLUMN "stockScore";

-- AlterTable
ALTER TABLE "User" ADD COLUMN     "canViewStoreFeedback" BOOLEAN NOT NULL DEFAULT false;
