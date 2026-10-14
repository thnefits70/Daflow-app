-- Garantías por despachar: guía subida por Michelle/Yair, Joao la gestiona,
-- Daniel o Allan revisan (2026-10-14).
CREATE TABLE "WarrantyDispatchGuide" (
    "id" TEXT NOT NULL,
    "guideNumber" TEXT NOT NULL,
    "fileUrl" TEXT NOT NULL,
    "fileName" TEXT,
    "comment" TEXT,
    "uploadedById" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "handledById" TEXT,
    "handledAt" TIMESTAMP(3),
    "verifiedById" TEXT,
    "verifiedAt" TIMESTAMP(3),
    CONSTRAINT "WarrantyDispatchGuide_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "WarrantyDispatchGuide_verifiedAt_idx" ON "WarrantyDispatchGuide"("verifiedAt");
ALTER TABLE "WarrantyDispatchGuide" ENABLE ROW LEVEL SECURITY;
