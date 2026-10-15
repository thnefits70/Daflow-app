-- Cancelaciones de guías pedidas por el dropshipper en el chat de Michelle (2026-10-15).
ALTER TABLE "CancelledGuideReport" ADD COLUMN "michelleChatId" TEXT;
ALTER TABLE "CancelledGuideReport" ADD COLUMN "michelleStatus" TEXT;
ALTER TABLE "CancelledGuideReport" ADD COLUMN "michelleOutOfHours" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "CancelledGuideReport" ADD COLUMN "michelleNote" TEXT;
ALTER TABLE "CancelledGuideReport" ADD COLUMN "michelleDecidedAt" TIMESTAMP(3);
ALTER TABLE "CancelledGuideReport" ADD COLUMN "michelleDecidedById" TEXT;
ALTER TABLE "CancelledGuideReport" ADD COLUMN "retainedPhotoUrl" TEXT;
CREATE INDEX "CancelledGuideReport_michelleStatus_idx" ON "CancelledGuideReport"("michelleStatus");
