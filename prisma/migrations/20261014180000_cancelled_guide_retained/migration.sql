-- Guías canceladas: Daniel o Allan confirman que retuvieron la guía (2026-10-14).
ALTER TABLE "CancelledGuideReport" ADD COLUMN "retainedAt" TIMESTAMP(3);
ALTER TABLE "CancelledGuideReport" ADD COLUMN "retainedById" TEXT;
ALTER TABLE "CancelledGuideReport" ADD CONSTRAINT "CancelledGuideReport_retainedById_fkey" FOREIGN KEY ("retainedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
