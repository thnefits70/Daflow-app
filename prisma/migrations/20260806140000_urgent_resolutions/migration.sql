-- Both PurchaseRequestUrgentReport and SupplierCredit have 0 rows in
-- production as of this migration (confirmed before writing it) — safe to
-- restructure without any data-preserving UPDATE statements.

-- AlterTable: PurchaseRequestUrgentReport — replace type/affectedQuantity
-- with typed quantities + mandatory media.
ALTER TABLE "PurchaseRequestUrgentReport" DROP COLUMN "type";
ALTER TABLE "PurchaseRequestUrgentReport" DROP COLUMN "affectedQuantity";
ALTER TABLE "PurchaseRequestUrgentReport" DROP COLUMN "resolvedAt";
ALTER TABLE "PurchaseRequestUrgentReport" DROP COLUMN "resolution";
ALTER TABLE "PurchaseRequestUrgentReport" ADD COLUMN "damagedQty" INTEGER NOT NULL DEFAULT 0;
ALTER TABLE "PurchaseRequestUrgentReport" ADD COLUMN "missingQty" INTEGER NOT NULL DEFAULT 0;
ALTER TABLE "PurchaseRequestUrgentReport" ADD COLUMN "incompleteQty" INTEGER NOT NULL DEFAULT 0;
ALTER TABLE "PurchaseRequestUrgentReport" ADD COLUMN "mediaUrls" TEXT[] NOT NULL DEFAULT '{}';

DROP TYPE IF EXISTS "PurchaseUrgentReportType";

-- CreateEnum
CREATE TYPE "UrgentResolutionType" AS ENUM ('CREDIT', 'REPLACEMENT', 'REFUND', 'WRITE_OFF');
CREATE TYPE "UrgentResolutionStatus" AS ENUM ('PENDING', 'COMPLETED', 'CANCELLED');

-- CreateTable
CREATE TABLE "PurchaseUrgentResolution" (
    "id" TEXT NOT NULL,
    "reportId" TEXT NOT NULL,
    "type" "UrgentResolutionType" NOT NULL,
    "quantity" INTEGER NOT NULL,
    "amount" DOUBLE PRECISION NOT NULL,
    "status" "UrgentResolutionStatus" NOT NULL DEFAULT 'PENDING',
    "replacementDueDate" TIMESTAMP(3),
    "replacementArrivedAt" TIMESTAMP(3),
    "replacementPhotoUrls" TEXT[] NOT NULL DEFAULT '{}',
    "replacementAiMatch" BOOLEAN,
    "replacementAiNote" TEXT,
    "replacementVerifiedById" TEXT,
    "refundProofUrl" TEXT,
    "refundAiMatch" BOOLEAN,
    "refundAiNote" TEXT,
    "bankConfirmedAt" TIMESTAMP(3),
    "bankConfirmedById" TEXT,
    "createdById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PurchaseUrgentResolution_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "PurchaseUrgentResolution_reportId_idx" ON "PurchaseUrgentResolution"("reportId");
CREATE INDEX "PurchaseUrgentResolution_status_idx" ON "PurchaseUrgentResolution"("status");

ALTER TABLE "PurchaseUrgentResolution" ADD CONSTRAINT "PurchaseUrgentResolution_reportId_fkey" FOREIGN KEY ("reportId") REFERENCES "PurchaseRequestUrgentReport"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "PurchaseUrgentResolution" ADD CONSTRAINT "PurchaseUrgentResolution_replacementVerifiedById_fkey" FOREIGN KEY ("replacementVerifiedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "PurchaseUrgentResolution" ADD CONSTRAINT "PurchaseUrgentResolution_bankConfirmedById_fkey" FOREIGN KEY ("bankConfirmedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "PurchaseUrgentResolution" ADD CONSTRAINT "PurchaseUrgentResolution_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AlterTable: SupplierCredit — link to the resolution instead of the report
-- directly, drop the now-unused refund fields (refund settles on the
-- resolution row itself, doesn't need a SupplierCredit at all).
ALTER TABLE "SupplierCredit" DROP CONSTRAINT IF EXISTS "SupplierCredit_urgentReportId_fkey";
DROP INDEX IF EXISTS "SupplierCredit_urgentReportId_key";
ALTER TABLE "SupplierCredit" DROP COLUMN "urgentReportId";
ALTER TABLE "SupplierCredit" DROP COLUMN "refundProofUrl";
ALTER TABLE "SupplierCredit" DROP COLUMN "refundedAt";
ALTER TABLE "SupplierCredit" ADD COLUMN "urgentResolutionId" TEXT;
CREATE UNIQUE INDEX "SupplierCredit_urgentResolutionId_key" ON "SupplierCredit"("urgentResolutionId");
ALTER TABLE "SupplierCredit" ADD CONSTRAINT "SupplierCredit_urgentResolutionId_fkey" FOREIGN KEY ("urgentResolutionId") REFERENCES "PurchaseUrgentResolution"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AlterTable: PurchaseRequest — nota opcional de Finanzas ("revisar algo")
ALTER TABLE "PurchaseRequest" ADD COLUMN "financeFlagNote" TEXT;
ALTER TABLE "PurchaseRequest" ADD COLUMN "financeFlaggedAt" TIMESTAMP(3);
ALTER TABLE "PurchaseRequest" ADD COLUMN "financeFlaggedById" TEXT;
ALTER TABLE "PurchaseRequest" ADD CONSTRAINT "PurchaseRequest_financeFlaggedById_fkey" FOREIGN KEY ("financeFlaggedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
