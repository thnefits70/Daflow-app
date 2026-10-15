-- CreateTable
CREATE TABLE "ProductVariantEdit" (
    "id" TEXT NOT NULL,
    "catalogItemId" TEXT NOT NULL,
    "action" TEXT NOT NULL,
    "detail" TEXT NOT NULL,
    "userId" TEXT,
    "userName" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ProductVariantEdit_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "ProductVariantEdit_catalogItemId_createdAt_idx" ON "ProductVariantEdit"("catalogItemId", "createdAt");

-- CreateIndex
CREATE INDEX "ProductVariantEdit_createdAt_idx" ON "ProductVariantEdit"("createdAt");

-- Misma protección que las demás tablas (API REST de Supabase cerrada).
ALTER TABLE "ProductVariantEdit" ENABLE ROW LEVEL SECURITY;
